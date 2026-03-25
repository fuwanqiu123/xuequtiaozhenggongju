// OpenLayers GIS应用 - JSON文件管理版
// 功能：1. JSON文件管理 2. 鼠标悬停显示地址 3. 搜索地点标注 4. 多边形编辑
(function() {
    'use strict';
    
    // 配置
    const CONFIG = {
        // 天地图KEY列表 - 支持多KEY轮换
        TIANDITU_KEYS: [
            'f14e4bb40aa997803b046bcfbbd7aaa4',
            '8fd8de7a161f3164a6da3f6615ecb386',
			'a7097827e4299ac41d3d50b45da1c193',
			'f0c0b3fbe98a7dcc92661e345f17e8ff',
            'e495b48f1c8eb41d17dd7f8a5bd47c18',
            '98ef794563cdf1d71e1411fd28091b0b',
            '4c2d0fc4e36cfd9d255aa3ca61567c7b',
            '1b9f5b539a57891fa8419423adf9e010',
            '20d9014ee072f032fc7d7fee8da01e21'
        ],
        INITIAL_CENTER: [112.91, 27.88],
        INITIAL_ZOOM: 12,
        GEOCODER_API: 'https://api.tianditu.gov.cn/geocoder',
        REVERSE_GEOCODER_API: 'https://api.tianditu.gov.cn/geocoder',
        POI_SEARCH_API: 'https://api.tianditu.gov.cn/v2/search',
        HOVER_DELAY: 700,
        MAX_HOVER_REQUESTS: 5
    };
    
    // ========== 天地图KEY轮换管理器 ==========
    const TiandituKeyManager = {
        keys: [...CONFIG.TIANDITU_KEYS],
        currentIndex: 0,
        failedKeys: new Set(),
        keyUsageCount: {},
        maxUsagePerKey: 4900, // 每个KEY的安全使用上限（天地图日限5000，预留100次余量）
        
        // 获取当前可用的KEY
        getCurrentKey() {
            return this.keys[this.currentIndex];
        },
        
        // 获取下一个可用的KEY
        getNextKey() {
            // 标记当前KEY为失败
            this.failedKeys.add(this.currentIndex);
            
            // 寻找下一个未失败的KEY
            let attempts = 0;
            while (attempts < this.keys.length) {
                this.currentIndex = (this.currentIndex + 1) % this.keys.length;
                if (!this.failedKeys.has(this.currentIndex)) {
                    const newKey = this.keys[this.currentIndex];
                    console.log(`[KEY轮换] 切换到新KEY (索引${this.currentIndex}): ${newKey.substring(0, 8)}...`);
                    showMessage(`已自动切换到备用KEY ${this.currentIndex + 1}/${this.keys.length}`, 'info');
                    return newKey;
                }
                attempts++;
            }
            
            // 所有KEY都失败了，重置并返回第一个
            console.warn('[KEY轮换] 所有KEY都已用完，重置状态');
            this.failedKeys.clear();
            this.currentIndex = 0;
            showMessage('警告：所有天地图KEY已用完，请明天再试或添加新KEY', 'warning');
            return this.keys[0];
        },
        
        // 记录KEY使用
        recordUsage(key) {
            if (!this.keyUsageCount[key]) {
                this.keyUsageCount[key] = 0;
            }
            this.keyUsageCount[key]++;
            
            // 如果接近上限，自动切换到下一个
            if (this.keyUsageCount[key] >= this.maxUsagePerKey) {
                console.log(`[KEY轮换] KEY ${key.substring(0, 8)}... 已使用 ${this.keyUsageCount[key]} 次，接近上限`);
                return this.getNextKey();
            }
            return key;
        },
        
        // 添加新KEY
        addKey(newKey) {
            if (!newKey || newKey.length < 10) {
                return { success: false, message: '无效的KEY格式' };
            }
            if (this.keys.includes(newKey)) {
                return { success: false, message: '该KEY已存在' };
            }
            this.keys.push(newKey);
            console.log('[KEY轮换] 添加新KEY成功，当前共有', this.keys.length, '个KEY');
            return { success: true, message: '添加成功' };
        },
        
        // 删除KEY
        removeKey(index) {
            if (index < 0 || index >= this.keys.length) {
                return { success: false, message: '无效的索引' };
            }
            if (this.keys.length <= 1) {
                return { success: false, message: '至少需要保留一个KEY' };
            }
            const removed = this.keys.splice(index, 1)[0];
            // 调整当前索引
            if (this.currentIndex >= this.keys.length) {
                this.currentIndex = 0;
            }
            // 重新构建失败集合
            this.failedKeys.clear();
            console.log('[KEY轮换] 删除KEY成功，当前剩余', this.keys.length, '个KEY');
            return { success: true, message: '删除成功' };
        },
        
        // 获取状态信息
        getStatus() {
            return {
                totalKeys: this.keys.length,
                currentIndex: this.currentIndex,
                currentKey: this.getCurrentKey().substring(0, 8) + '...',
                failedCount: this.failedKeys.size,
                usageStats: this.keyUsageCount
            };
        },
        
        // 重置所有状态
        reset() {
            this.currentIndex = 0;
            this.failedKeys.clear();
            this.keyUsageCount = {};
            console.log('[KEY轮换] 状态已重置');
        }
    };
    
    // 应用状态
    const AppState = {
        currentMode: 'browse',
        selectedFeature: null,
        isDrawing: false,
        searchResults: [],
        lastClickedPoint: null,
        polygonNames: {},
        hoverTimer: null,
        lastHoverCoordinate: null,
        hoverRequestCount: 0,
        // JSON文件管理
        jsonFiles: [],
        selectedJSONFile: null,
        jsonFeatureMap: new Map(),
        hiddenFiles: new Set(), // 存储被隐藏的文件ID
        nextFileId: 1,
        // 顶点编辑相关
        selectedVertexIndex: null,
        selectedVertexCoordinates: null,
        // 辅助要素选择
        selectedAssistFeature: null,
        // 辅助要素显示状态
        assistFeaturesVisible: true,
        // 标星的学区文件ID列表
        starredFiles: new Set(),
        // 测量功能状态
        measureMode: null, // 'length' | 'area' | null
        measureFeatures: [],
        measureTooltip: null,
        measureHelpTooltip: null,
        // 辅助元素文件管理
        assistFiles: [],
        selectedAssistFile: null,
        assistFeatureMap: new Map(),
        hiddenAssistFiles: new Set(),
        nextAssistFileId: 1,
        // 侧边栏收缩状态
        sidebarCollapsed: false,
        // 右侧边栏收缩状态
        rightSidebarCollapsed: false,
        // 辅助多边形编辑顶点选择
        selectedAssistVertexIndex: null,
        selectedAssistVertexCoordinates: null,
        // 地图点击处理器
        mapClickHandler: null
    };
    
    // 全局变量
    let map;
    let vectorSource;
    let lineSource;
    let searchSource;
    let highlightSource;
    let drawInteraction;
    let selectInteraction;
    let modifyInteraction;
    let snapInteraction;
    // 辅助要素图层
    let assistPolygonSource;
    let assistTextSource;
    let assistPointSource; // 辅助点图层
    // 辅助要素选择交互
    let assistSelectInteraction;
    // 辅助多边形编辑交互
    let assistPolygonModifyInteraction;
    // 测量图层和交互
    let measureSource;
    let measureLayer;
    let measureDrawInteraction;
    let measureTooltipElement;
    let measureHelpTooltipElement;
    
    // ========== 工具函数 ==========
    function updateStatus() {
        let modeText = '浏览';
        
        // 如果有测量模式，优先显示测量模式
        if (AppState.measureMode === 'length') {
            modeText = '测距模式';
        } else if (AppState.measureMode === 'area') {
            modeText = '测面模式';
        } else {
            const modeMap = {
                'browse': '浏览',
                'drawPolygon': '绘制多边形',
                'drawLine': '绘制辅助线',
                'drawAssistPolygon': '绘制辅助多边形',
                'drawAssistText': '添加辅助文字',
                'assistSelect': '选择辅助要素',
                'editPolygon': '编辑多边形',
                'editAssistPolygon': '编辑辅助多边形',
                'select': '选择'
            };
            modeText = modeMap[AppState.currentMode] || '浏览';
        }
        
        $('#currentMode').text(modeText);
        $('#polygonCount').text(vectorSource ? vectorSource.getFeatures().length : 0);
        $('#lineCount').text(lineSource ? lineSource.getFeatures().length : 0);
        $('#assistPolygonCount').text(assistPolygonSource ? assistPolygonSource.getFeatures().length : 0);
        $('#assistTextCount').text(assistTextSource ? assistTextSource.getFeatures().length : 0);
        $('#assistPointCount').text(assistPointSource ? assistPointSource.getFeatures().length : 0);
        $('#selectedJSON').text(AppState.selectedJSONFile ? AppState.selectedJSONFile.name : '无选中学区');
        $('#jsonFileCountBadge').text(AppState.jsonFiles.length);
        $('#assistFileCountBadge').text(AppState.assistFiles.length);
    }
    
    function showMessage(msg, type = 'info') {
        const typeText = type === 'success' ? '成功' : 
                        type === 'error' ? '错误' : 
                        type === 'warning' ? '警告' : '提示';
        console.log(`[${typeText}] ${msg}`);
        
        // 创建简单的toast提示
        const toast = $(`<div class="toast-message toast-${type}">${msg}</div>`);
        $('body').append(toast);
        
        // 添加toast样式
        if (!$('#toastStyles').length) {
            $('head').append(`
                <style id="toastStyles">
                    .toast-message {
                        position: fixed;
                        top: 60px;
                        right: 20px;
                        padding: 12px 20px;
                        border-radius: 6px;
                        color: white;
                        font-size: 14px;
                        z-index: 10000;
                        animation: slideIn 0.3s ease;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                    }
                    .toast-success { background: #2ecc71; }
                    .toast-error { background: #e74c3c; }
                    .toast-warning { background: #f39c12; }
                    .toast-info { background: #3498db; }
                    @keyframes slideIn {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                </style>
            `);
        }
        
        setTimeout(() => {
            toast.fadeOut(300, function() { $(this).remove(); });
        }, 3000);
    }
    
    // ========== 辅助要素样式恢复函数 ==========
    
    // 从GeoJSON属性中恢复样式
    function restoreFeatureStyle(feature, featureData) {
        if (!featureData.properties) return;
        
        const props = featureData.properties;
        const geometryType = feature.getGeometry().getType();
        
        console.log(`restoreFeatureStyle: type=${props.type}, geometry=${geometryType}, text=${props.text}, iconType=${props.iconType}`);
        
        // 根据类型应用样式
        if (props.type === 'assistLine' || geometryType === 'LineString') {
            // 辅助线样式
            const strokeColor = props.stroke || props.color || '#ff0000';
            const strokeWidth = props['stroke-width'] || props.width || 2;
            const strokeOpacity = props['stroke-opacity'] || props.opacity || 0.8;
            const dashArray = props['stroke-dasharray'] || '10,5';
            
            const style = new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: hexToRgba(strokeColor, strokeOpacity),
                    width: strokeWidth,
                    lineDash: dashArray.split(',').map(Number)
                })
            });
            feature.setStyle(style);
            console.log('  -> 应用辅助线样式');
            
        } else if (props.type === 'assistPolygon' || geometryType === 'Polygon') {
            // 辅助多边形样式
            const fillColor = props.fill || props.color || '#ff9900';
            const fillOpacity = props['fill-opacity'] || props.opacity || 0.3;
            const strokeColor = props.stroke || '#ff6600';
            const strokeWidth = props['stroke-width'] || 1;
            const strokeOpacity = props['stroke-opacity'] || 0.8;
            
            // 构建样式数组，包含多边形样式和文字标签
            const styles = [
                new ol.style.Style({
                    fill: new ol.style.Fill({
                        color: hexToRgba(fillColor, fillOpacity)
                    }),
                    stroke: new ol.style.Stroke({
                        color: hexToRgba(strokeColor, strokeOpacity),
                        width: strokeWidth
                    })
                })
            ];
            
            // 如果有名称，添加文字标签
            const name = props.name || feature.get('name');
            if (name) {
                const geometry = feature.getGeometry();
                if (geometry && geometry.getType() === 'Polygon') {
                    const extent = geometry.getExtent();
                    const center = ol.extent.getCenter(extent);
                    
                    styles.push(
                        new ol.style.Style({
                            geometry: new ol.geom.Point(center),
                            text: new ol.style.Text({
                                text: name,
                                font: 'bold 14px Arial',
                                fill: new ol.style.Fill({
                                    color: strokeColor || '#9b59b6'
                                }),
                                stroke: new ol.style.Stroke({
                                    color: 'white',
                                    width: 3
                                })
                            })
                        })
                    );
                    console.log(`  -> 添加辅助多边形名称标签: ${name}`);
                }
            }
            
            feature.setStyle(styles);
            console.log('  -> 应用辅助多边形样式');
            
        } else if (props.type === 'assistText' || (geometryType === 'Point' && props.type !== 'assistPoint' && !props.iconType && props.text)) {
            // 辅助文字样式（只处理没有iconType但有text的Point，即纯文字标注）
            const text = props.text || '标注';
            const fontSize = props['font-size'] || 16;
            const fontColor = props['font-color'] || props.color || '#e67e22';
            const fontFamily = props['font-family'] || 'Arial, sans-serif';
            const fontWeight = props['font-weight'] || 'bold';
            
            // 修复：简化样式配置，移除可能有问题的padding和backgroundFill参数
            const style = new ol.style.Style({
                text: new ol.style.Text({
                    text: text,
                    font: `${fontWeight} ${fontSize}px ${fontFamily}`,
                    fill: new ol.style.Fill({
                        color: fontColor
                    }),
                    stroke: new ol.style.Stroke({
                        color: 'white',
                        width: 3
                    }),
                    offsetY: -15
                })
            });
            feature.setStyle(style);
            
            // 修复：强制刷新要素以确保样式生效
            feature.changed();
            
            console.log(`  -> 应用辅助文字样式: text=${text}, color=${fontColor}`);
        } else {
            console.log('  -> 未应用样式（可能是辅助点或其他类型）');
        }
        // 注意：辅助点(assistPoint)不在这里设置样式，由图层样式函数动态渲染
    }
    
    // 十六进制颜色转RGBA
    function hexToRgba(hex, opacity = 1) {
        hex = hex.replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    
    // ========== 样式提取工具函数（BUG修复） ==========
    
    /**
     * 从RGBA颜色字符串中提取十六进制颜色和透明度
     */
    function parseRgbaToHex(rgba) {
        if (!rgba) return { hex: '#000000', opacity: 1 };
        
        // 如果是十六进制格式
        if (rgba.startsWith('#')) {
            return { hex: rgba.substring(0, 7), opacity: 1 };
        }
        
        // 解析 rgba(r, g, b, a) 格式
        const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const r = parseInt(match[1]).toString(16).padStart(2, '0');
            const g = parseInt(match[2]).toString(16).padStart(2, '0');
            const b = parseInt(match[3]).toString(16).padStart(2, '0');
            const opacity = match[4] ? parseFloat(match[4]) : 1;
            return { hex: `#${r}${g}${b}`, opacity: opacity };
        }
        
        return { hex: '#000000', opacity: 1 };
    }
    
    /**
     * 从Feature中提取样式属性
     */
    function extractStyleFromFeature(feature, type) {
        const style = feature.getStyle();
        const properties = {};
        
        // 获取实际应用的样式（如果是函数则执行）
        let actualStyle = style;
        if (typeof style === 'function') {
            actualStyle = style(feature, 0);
        }
        
        // 处理数组样式
        if (Array.isArray(actualStyle)) {
            actualStyle = actualStyle[0];
        }
        
        if (!actualStyle) {
            // 如果没有自定义样式，返回默认样式
            if (type === 'assistLine') {
                return {
                    stroke: '#e74c3c',
                    'stroke-width': 2,
                    'stroke-opacity': 0.8,
                    'stroke-dasharray': '5,5'
                };
            } else if (type === 'assistPolygon') {
                return {
                    fill: '#9b59b6',
                    'fill-opacity': 0.2,
                    stroke: '#9b59b6',
                    'stroke-width': 2,
                    'stroke-opacity': 0.8
                };
            } else if (type === 'assistText') {
                return {
                    text: feature.get('text') || '',
                    'font-size': 16,
                    'font-color': '#e67e22',
                    'font-family': 'Arial, sans-serif',
                    'font-weight': 'bold',
                    'background-color': '#ffffff',
                    'background-opacity': 0.7
                };
            }
            return properties;
        }
        
        const stroke = actualStyle.getStroke && actualStyle.getStroke();
        const fill = actualStyle.getFill && actualStyle.getFill();
        const text = actualStyle.getText && actualStyle.getText();
        
        if (type === 'assistLine' && stroke) {
            const color = stroke.getColor() || '#e74c3c';
            const parsed = parseRgbaToHex(color);
            properties.stroke = parsed.hex;
            properties['stroke-opacity'] = parsed.opacity;
            properties['stroke-width'] = stroke.getWidth() || 2;
            
            // 提取虚线模式
            const lineDash = stroke.getLineDash();
            if (lineDash && lineDash.length > 0) {
                properties['stroke-dasharray'] = lineDash.join(',');
            } else {
                properties['stroke-dasharray'] = '5,5';
            }
        } 
        else if (type === 'assistPolygon') {
            if (fill) {
                const fillColor = fill.getColor() || 'rgba(155, 89, 182, 0.2)';
                const parsed = parseRgbaToHex(fillColor);
                properties.fill = parsed.hex;
                properties['fill-opacity'] = parsed.opacity;
            }
            if (stroke) {
                const strokeColor = stroke.getColor() || '#9b59b6';
                const parsed = parseRgbaToHex(strokeColor);
                properties.stroke = parsed.hex;
                properties['stroke-opacity'] = parsed.opacity;
                properties['stroke-width'] = stroke.getWidth() || 2;
            }
        } 
        else if (type === 'assistText' && text) {
            properties.text = text.getText() || feature.get('text') || '';
            
            // 解析字体
            const font = text.getFont() || 'bold 16px Arial';
            const fontMatch = font.match(/(normal|bold|italic)?\s*(\d+)px\s*(.+)/);
            if (fontMatch) {
                properties['font-weight'] = fontMatch[1] || 'normal';
                properties['font-size'] = parseInt(fontMatch[2]);
                properties['font-family'] = fontMatch[3];
            } else {
                properties['font-size'] = 16;
                properties['font-family'] = 'Arial, sans-serif';
                properties['font-weight'] = 'bold';
            }
            
            // 文字颜色
            const textFill = text.getFill && text.getFill();
            if (textFill) {
                const textColor = textFill.getColor() || '#e67e22';
                properties['font-color'] = parseRgbaToHex(textColor).hex;
            }
            
            // 背景颜色
            const bgFill = text.getBackgroundFill && text.getBackgroundFill();
            if (bgFill) {
                const bgColor = bgFill.getColor() || 'rgba(255,255,255,0.7)';
                const parsed = parseRgbaToHex(bgColor);
                properties['background-color'] = parsed.hex;
                properties['background-opacity'] = parsed.opacity;
            } else {
                properties['background-color'] = '#ffffff';
                properties['background-opacity'] = 0.7;
            }
        }
        
        return properties;
    }
    
    // ========== JSON文件管理 ==========
    
    // 更新JSON文件列表显示
    function updateJSONFileList(searchTerm = '') {
        const $jsonFileList = $('#jsonFileList');
        
        if (AppState.jsonFiles.length === 0) {
            $jsonFileList.html('<div class="no-data">暂无学区文件，请点击"导入"添加文件</div>');
            updateStatus();
            return;
        }
        
        // 对文件列表进行排序：标星的文件排在前面
        const sortedFiles = [...AppState.jsonFiles].sort((a, b) => {
            const aStarred = AppState.starredFiles.has(a.id);
            const bStarred = AppState.starredFiles.has(b.id);
            if (aStarred && !bStarred) return -1;
            if (!aStarred && bStarred) return 1;
            return 0;
        });
        
        let html = '';
        let hasMatch = false;
        
        sortedFiles.forEach(jsonFile => {
            const isSelected = AppState.selectedJSONFile && AppState.selectedJSONFile.id === jsonFile.id;
            const isHidden = AppState.hiddenFiles.has(jsonFile.id);
            const features = AppState.jsonFeatureMap.get(jsonFile.id) || [];
            const featureCount = features.length;
            
            // 搜索过滤
            const matchesSearch = !searchTerm || jsonFile.name.toLowerCase().includes(searchTerm.toLowerCase());
            if (searchTerm && matchesSearch) {
                hasMatch = true;
            }
            
            // 如果有搜索词但不匹配，隐藏该项
            const searchClass = searchTerm ? (matchesSearch ? 'search-match' : 'search-hidden') : '';
            const highlightClass = (searchTerm && matchesSearch) ? 'search-highlight' : '';
            
            // 检查是否已标星
            const isStarred = AppState.starredFiles.has(jsonFile.id);
            
            html += `
                <div class="json-file-item ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-file' : ''} ${searchClass} ${highlightClass} ${isStarred ? 'starred' : ''}" data-json-id="${jsonFile.id}" data-file-name="${jsonFile.name.toLowerCase()}">
                    <div class="json-file-main">
                        <div class="json-file-info">
                            <div class="json-file-name" title="${jsonFile.name}">
                                ${isStarred ? '<i class="fas fa-star star-icon"></i> ' : ''}${jsonFile.name}
                            </div>
                            <div class="json-file-meta">${featureCount} 个图形 · ${jsonFile.importTime}</div>
                        </div>
                        <div class="json-file-count">${featureCount}</div>
                    </div>
                    <div class="json-file-actions-row">
                        <button class="btn-star ${isStarred ? 'starred' : ''}" data-json-id="${jsonFile.id}" title="${isStarred ? '取消标星' : '标星该学区'}">
                            <i class="fas ${isStarred ? 'fa-star' : 'fa-star-o'}"></i> ${isStarred ? '已标星' : '标星'}
                        </button>
                        <button class="btn-visibility ${isHidden ? 'hidden-state' : ''}" data-json-id="${jsonFile.id}" title="${isHidden ? '显示该文件' : '隐藏该文件'}">
                            <i class="fas ${isHidden ? 'fa-eye-slash' : 'fa-eye'}"></i>
                        </button>
                        <button class="btn-clear" data-json-id="${jsonFile.id}" title="清除该文件中的所有图形">
                            <i class="fas fa-eraser"></i> 清除
                        </button>
                        <button class="btn-remove" data-json-id="${jsonFile.id}" title="删除该文件及其所有图形">
                            <i class="fas fa-trash-alt"></i> 移除
                        </button>
                    </div>
                </div>
            `;
        });
        
        $jsonFileList.html(html);
        
        // 如果有搜索匹配项，滚动到第一个匹配项
        if (searchTerm && hasMatch) {
            const $firstMatch = $jsonFileList.find('.search-match').first();
            if ($firstMatch.length) {
                $jsonFileList.animate({
                    scrollTop: $firstMatch.position().top + $jsonFileList.scrollTop() - 10
                }, 300);
            }
        }
        
        // 绑定文件项点击事件（选择文件）- 使用事件委托
        $jsonFileList.off('click').on('click', '.json-file-item', function(e) {
            // 如果点击的是按钮，不触发选择
            if ($(e.target).closest('.btn-clear, .btn-remove, .btn-visibility, .btn-star').length > 0) {
                return;
            }
            const jsonId = $(this).data('json-id');
            selectJSONFile(jsonId);
        });
        
        // 绑定标星按钮事件
        $jsonFileList.off('click', '.btn-star').on('click', '.btn-star', function(e) {
            e.stopPropagation();
            const jsonId = $(this).data('json-id');
            toggleFileStar(jsonId);
        });
        
        // 绑定隐藏/显示按钮事件
        $jsonFileList.off('click', '.btn-visibility').on('click', '.btn-visibility', function(e) {
            e.stopPropagation();
            const jsonId = $(this).data('json-id');
            toggleFileVisibility(jsonId);
        });
        
        // 绑定清除按钮事件
        $jsonFileList.off('click', '.btn-clear').on('click', '.btn-clear', function(e) {
            e.stopPropagation();
            const jsonId = $(this).data('json-id');
            clearJSONFile(jsonId);
        });
        
        // 绑定移除按钮事件
        $jsonFileList.off('click', '.btn-remove').on('click', '.btn-remove', function(e) {
            e.stopPropagation();
            const jsonId = $(this).data('json-id');
            removeJSONFile(jsonId);
        });
        
        updateStatus();
    }
    
    // 切换文件标星状态
    function toggleFileStar(jsonId) {
        const jsonFile = AppState.jsonFiles.find(f => f.id === jsonId);
        if (!jsonFile) return;
        
        if (AppState.starredFiles.has(jsonId)) {
            AppState.starredFiles.delete(jsonId);
            showMessage(`已取消标星: ${jsonFile.name}`, 'info');
        } else {
            AppState.starredFiles.add(jsonId);
            showMessage(`已标星学区: ${jsonFile.name}`, 'success');
        }
        
        // 更新文件列表显示（会重新排序）
        updateJSONFileList($('#fileSearchInput').val());
    }
    
    // 切换文件可见性
    function toggleFileVisibility(jsonId) {
        if (AppState.hiddenFiles.has(jsonId)) {
            AppState.hiddenFiles.delete(jsonId);
            console.log(`显示文件: ${jsonId}`);
        } else {
            AppState.hiddenFiles.add(jsonId);
            console.log(`隐藏文件: ${jsonId}`);
        }
        
        // 刷新地图显示
        vectorSource.changed();
        
        // 更新文件列表显示
        updateJSONFileList($('#fileSearchInput').val());
        
        // 更新全部隐藏按钮状态
        updateToggleAllButton();
    }
    
    // 切换所有文件的可见性
    function toggleAllFilesVisibility() {
        const allFilesCount = AppState.jsonFiles.length;
        const hiddenFilesCount = AppState.hiddenFiles.size;
        
        if (hiddenFilesCount < allFilesCount) {
            // 如果还有未隐藏的文件，全部隐藏
            AppState.jsonFiles.forEach(file => {
                AppState.hiddenFiles.add(file.id);
            });
            showMessage('已隐藏所有文件', 'info');
        } else {
            // 如果全部都已隐藏，全部显示
            AppState.hiddenFiles.clear();
            showMessage('已显示所有文件', 'success');
        }
        
        // 刷新地图显示
        vectorSource.changed();
        
        // 更新文件列表显示
        updateJSONFileList($('#fileSearchInput').val());
        
        // 更新全部隐藏按钮状态
        updateToggleAllButton();
    }
    
    // 更新全部隐藏按钮状态
    function updateToggleAllButton() {
        const $btn = $('#toggleAllFilesVisibility');
        const allFilesCount = AppState.jsonFiles.length;
        const hiddenFilesCount = AppState.hiddenFiles.size;
        
        if (allFilesCount > 0 && hiddenFilesCount === allFilesCount) {
            $btn.addClass('all-hidden');
            $btn.html('<i class="fas fa-eye-slash"></i> 全部');
            $btn.attr('title', '显示所有文件');
        } else {
            $btn.removeClass('all-hidden');
            $btn.html('<i class="fas fa-eye"></i> 全部');
            $btn.attr('title', '隐藏所有文件');
        }
    }
    
    // ========== 侧边栏收缩功能 ==========
    function toggleSidebar() {
        AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
        const $sidebar = $('#sidebar');
        const $toggle = $('#sidebarToggle');
        
        if (AppState.sidebarCollapsed) {
            $sidebar.addClass('collapsed');
            $toggle.attr('title', '展开侧边栏');
        } else {
            $sidebar.removeClass('collapsed');
            $toggle.attr('title', '收缩侧边栏');
        }
        
        // 触发地图resize事件以适应新尺寸
        setTimeout(() => {
            if (map) {
                map.updateSize();
            }
        }, 300);
    }
    
    // ========== 右侧边栏收缩功能 ==========
    function toggleRightSidebar() {
        AppState.rightSidebarCollapsed = !AppState.rightSidebarCollapsed;
        const $sidebar = $('#rightSidebar');
        const $toggle = $('#rightSidebarToggle');
        
        if (AppState.rightSidebarCollapsed) {
            $sidebar.addClass('collapsed');
            $toggle.attr('title', '展开侧边栏');
        } else {
            $sidebar.removeClass('collapsed');
            $toggle.attr('title', '收缩侧边栏');
        }
        
        // 触发地图resize事件以适应新尺寸
        setTimeout(() => {
            if (map) {
                map.updateSize();
            }
        }, 300);
    }
    
    // ========== 辅助元素文件管理 ==========
    
    // 更新辅助元素文件列表显示
    function updateAssistFileList(searchTerm = '') {
        const $assistFileList = $('#assistFileList');
        
        if (AppState.assistFiles.length === 0) {
            $assistFileList.html('<div class="no-data">暂无辅助元素文件，请点击"导入"添加文件</div>');
            updateAssistStatus();
            return;
        }
        
        let html = '';
        let hasMatch = false;
        
        AppState.assistFiles.forEach(assistFile => {
            const isSelected = AppState.selectedAssistFile && AppState.selectedAssistFile.id === assistFile.id;
            const isHidden = AppState.hiddenAssistFiles.has(assistFile.id);
            const features = AppState.assistFeatureMap.get(assistFile.id) || [];
            const featureCount = features.length;
            
            // 搜索过滤
            const matchesSearch = !searchTerm || assistFile.name.toLowerCase().includes(searchTerm.toLowerCase());
            if (searchTerm && matchesSearch) {
                hasMatch = true;
            }
            
            // 如果有搜索词但不匹配，隐藏该项
            const searchClass = searchTerm ? (matchesSearch ? 'search-match' : 'search-hidden') : '';
            const highlightClass = (searchTerm && matchesSearch) ? 'search-highlight' : '';
            
            // 统计各类型要素数量
            let lineCount = 0, polygonCount = 0, textCount = 0, pointCount = 0;
            features.forEach(f => {
                const type = f.getGeometry().getType();
                if (type === 'LineString') lineCount++;
                else if (type === 'Polygon') polygonCount++;
                else if (type === 'Point') {
                    if (f.get('iconType')) pointCount++;
                    else textCount++;
                }
            });
            
            const detailInfo = [];
            if (lineCount > 0) detailInfo.push(`线${lineCount}`);
            if (polygonCount > 0) detailInfo.push(`多边形${polygonCount}`);
            if (textCount > 0) detailInfo.push(`文字${textCount}`);
            if (pointCount > 0) detailInfo.push(`点${pointCount}`);
            
            // 默认图层不显示移除按钮
            const isDefaultLayer = assistFile.isDefault === true;
            const removeButton = isDefaultLayer ? '' : `
                <button class="btn-remove" data-assist-id="${assistFile.id}" title="删除该文件">
                    <i class="fas fa-trash-alt"></i> 移除
                </button>
            `;
            
            html += `
                <div class="assist-file-item ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-file' : ''} ${searchClass} ${highlightClass} ${isDefaultLayer ? 'default-layer' : ''}" data-assist-id="${assistFile.id}" data-file-name="${assistFile.name.toLowerCase()}">
                    <div class="assist-file-main">
                        <div class="assist-file-info">
                            <div class="assist-file-name" title="${assistFile.name}">${isDefaultLayer ? '<i class="fas fa-layer-group" style="color:#3498db;"></i> ' : ''}${assistFile.name}</div>
                            <div class="assist-file-meta">${detailInfo.join(' · ')} · ${assistFile.importTime}</div>
                        </div>
                        <div class="assist-file-count">${featureCount}</div>
                    </div>
                    <div class="assist-file-actions-row">
                        <button class="btn-locate" data-assist-id="${assistFile.id}" title="定位到该文件">
                            <i class="fas fa-crosshairs"></i> 定位
                        </button>
                        <button class="btn-visibility ${isHidden ? 'hidden-state' : ''}" data-assist-id="${assistFile.id}" title="${isHidden ? '显示该文件' : '隐藏该文件'}">
                            <i class="fas ${isHidden ? 'fa-eye-slash' : 'fa-eye'}"></i>
                        </button>
                        <button class="btn-export-single" data-assist-id="${assistFile.id}" title="导出该文件">
                            <i class="fas fa-download"></i> 导出
                        </button>
                        ${removeButton}
                    </div>
                </div>
            `;
        });
        
        $assistFileList.html(html);
        
        // 如果有搜索匹配项，滚动到第一个匹配项
        if (searchTerm && hasMatch) {
            const $firstMatch = $assistFileList.find('.search-match').first();
            if ($firstMatch.length) {
                $assistFileList.animate({
                    scrollTop: $firstMatch.position().top + $assistFileList.scrollTop() - 10
                }, 300);
            }
        }
        
        // 绑定文件项点击事件（选择文件）
        $assistFileList.off('click').on('click', '.assist-file-item', function(e) {
            if ($(e.target).closest('.btn-locate, .btn-remove, .btn-visibility, .btn-export-single').length > 0) {
                return;
            }
            const assistId = $(this).data('assist-id');
            selectAssistFile(assistId);
        });
        
        // 绑定定位按钮事件
        $assistFileList.off('click', '.btn-locate').on('click', '.btn-locate', function(e) {
            e.stopPropagation();
            const assistId = $(this).data('assist-id');
            locateAssistFile(assistId);
        });
        
        // 绑定隐藏/显示按钮事件
        $assistFileList.off('click', '.btn-visibility').on('click', '.btn-visibility', function(e) {
            e.stopPropagation();
            const assistId = $(this).data('assist-id');
            toggleAssistFileVisibility(assistId);
        });
        
        // 绑定导出按钮事件
        $assistFileList.off('click', '.btn-export-single').on('click', '.btn-export-single', function(e) {
            e.stopPropagation();
            const assistId = $(this).data('assist-id');
            exportSingleAssistFile(assistId);
        });
        
        // 绑定移除按钮事件
        $assistFileList.off('click', '.btn-remove').on('click', '.btn-remove', function(e) {
            e.stopPropagation();
            const assistId = $(this).data('assist-id');
            removeAssistFile(assistId);
        });
        
        updateAssistStatus();
    }
    
    // 更新辅助元素状态显示
    function updateAssistStatus() {
        $('#assistFileCountBadge').text(AppState.assistFiles.length);
        $('#assistPointCount').text(assistPointSource ? assistPointSource.getFeatures().length : 0);
    }
    
    // 选择辅助元素文件
    function selectAssistFile(assistId) {
        const assistFile = AppState.assistFiles.find(f => f.id === assistId);
        if (!assistFile) return;
        
        AppState.selectedAssistFile = assistFile;
        updateAssistFileList($('#assistFileSearchInput').val());
        
        console.log(`选中辅助元素文件: ${assistFile.name}`);
    }
    
    // 定位辅助元素文件
    function locateAssistFile(assistId) {
        const features = AppState.assistFeatureMap.get(assistId) || [];
        if (features.length === 0) {
            showMessage('该文件中没有要素', 'warning');
            return;
        }
        
        const extent = ol.extent.createEmpty();
        features.forEach(feature => {
            const geometry = feature.getGeometry();
            if (geometry) {
                ol.extent.extend(extent, geometry.getExtent());
            }
        });
        
        if (extent && extent[0] !== Infinity) {
            map.getView().fit(extent, {
                padding: [50, 50, 50, 50],
                maxZoom: 16,
                duration: 800
            });
            showMessage('已定位到辅助元素文件', 'success');
        }
    }
    
    // 切换辅助元素文件可见性
    function toggleAssistFileVisibility(assistId) {
        if (AppState.hiddenAssistFiles.has(assistId)) {
            AppState.hiddenAssistFiles.delete(assistId);
            // 显示该文件的要素
            const features = AppState.assistFeatureMap.get(assistId) || [];
            features.forEach(feature => {
                feature.setStyle(null); // 恢复默认样式
            });
        } else {
            AppState.hiddenAssistFiles.add(assistId);
            // 隐藏该文件的要素
            const features = AppState.assistFeatureMap.get(assistId) || [];
            features.forEach(feature => {
                feature.setStyle(new ol.style.Style({})); // 空样式隐藏要素
            });
        }
        
        // 刷新图层
        lineSource.changed();
        assistPolygonSource.changed();
        assistTextSource.changed();
        assistPointSource.changed();
        
        updateAssistFileList($('#assistFileSearchInput').val());
        updateToggleAllAssistButton();
    }
    
    // 切换所有辅助元素文件的可见性
    function toggleAllAssistFilesVisibility() {
        const allFilesCount = AppState.assistFiles.length;
        const hiddenFilesCount = AppState.hiddenAssistFiles.size;
        
        if (hiddenFilesCount < allFilesCount) {
            // 如果还有未隐藏的文件，全部隐藏
            AppState.assistFiles.forEach(file => {
                AppState.hiddenAssistFiles.add(file.id);
                const features = AppState.assistFeatureMap.get(file.id) || [];
                features.forEach(feature => {
                    feature.setStyle(new ol.style.Style({}));
                });
            });
            showMessage('已隐藏所有辅助元素文件', 'info');
        } else {
            // 如果全部都已隐藏，全部显示
            AppState.hiddenAssistFiles.clear();
            AppState.assistFiles.forEach(file => {
                const features = AppState.assistFeatureMap.get(file.id) || [];
                features.forEach(feature => {
                    feature.setStyle(null);
                });
            });
            showMessage('已显示所有辅助元素文件', 'success');
        }
        
        lineSource.changed();
        assistPolygonSource.changed();
        assistTextSource.changed();
        assistPointSource.changed();
        
        updateAssistFileList($('#assistFileSearchInput').val());
        updateToggleAllAssistButton();
    }
    
    // 更新全部隐藏按钮状态
    function updateToggleAllAssistButton() {
        const $btn = $('#toggleAllAssistFilesVisibility');
        const allFilesCount = AppState.assistFiles.length;
        const hiddenFilesCount = AppState.hiddenAssistFiles.size;
        
        if (allFilesCount > 0 && hiddenFilesCount === allFilesCount) {
            $btn.addClass('all-hidden');
            $btn.html('<i class="fas fa-eye-slash"></i> 全部');
            $btn.attr('title', '显示所有文件');
        } else {
            $btn.removeClass('all-hidden');
            $btn.html('<i class="fas fa-eye"></i> 全部');
            $btn.attr('title', '隐藏所有文件');
        }
    }
    
    // 导出单个辅助元素文件
    function exportSingleAssistFile(assistId) {
        const assistFile = AppState.assistFiles.find(f => f.id === assistId);
        const features = AppState.assistFeatureMap.get(assistId) || [];
        
        if (!assistFile || features.length === 0) {
            showMessage('没有可导出的辅助元素', 'warning');
            return;
        }
        
        try {
            const geoJSON = {
                type: 'FeatureCollection',
                features: [],
                properties: {
                    fileName: assistFile.name,
                    exportTime: new Date().toLocaleString(),
                    source: 'GIS-APP 辅助元素导出'
                }
            };
            
            const format = new ol.format.GeoJSON();
            
            features.forEach(function(feature, index) {
                // 调试：导出前的坐标
                const geomBefore = feature.getGeometry();
                const coordsBefore = geomBefore.getType() === 'Polygon' ? 
                    geomBefore.getCoordinates()[0][0] : geomBefore.getCoordinates();
                console.log(`导出前坐标[${index}]:`, coordsBefore);
                
                const geoJSONFeature = format.writeFeatureObject(feature, {
                    featureProjection: 'EPSG:3857',
                    dataProjection: 'EPSG:4326'
                });
                
                // 调试：导出后的坐标
                const coordsAfter = geoJSONFeature.geometry.coordinates;
                console.log(`导出后坐标[${index}]:`, Array.isArray(coordsAfter) && coordsAfter[0] ? coordsAfter[0][0] : coordsAfter);
                
                geoJSONFeature.properties = geoJSONFeature.properties || {};
                
                // 根据类型保存相应属性
                const geometryType = feature.getGeometry().getType();
                if (geometryType === 'LineString') {
                    geoJSONFeature.properties.type = 'assistLine';
                    const styleProps = extractStyleFromFeature(feature, 'assistLine');
                    Object.assign(geoJSONFeature.properties, styleProps);
                } else if (geometryType === 'Polygon') {
                    geoJSONFeature.properties.type = 'assistPolygon';
                    const name = feature.get('name');
                    if (name) geoJSONFeature.properties.name = name;
                    const styleProps = extractStyleFromFeature(feature, 'assistPolygon');
                    Object.assign(geoJSONFeature.properties, styleProps);
                } else if (geometryType === 'Point') {
                    const iconType = feature.get('iconType');
                    if (iconType) {
                        geoJSONFeature.properties.type = 'assistPoint';
                        geoJSONFeature.properties.iconType = iconType;
                        geoJSONFeature.properties.iconColor = feature.get('iconColor') || '#e74c3c';
                        geoJSONFeature.properties.iconSize = feature.get('iconSize') || 1.0;
                        const text = feature.get('text');
                        if (text) {
                            geoJSONFeature.properties.text = text;
                            geoJSONFeature.properties.textColor = feature.get('textColor') || '#333333';
                        }
                    } else {
                        geoJSONFeature.properties.type = 'assistText';
                        const styleProps = extractStyleFromFeature(feature, 'assistText');
                        Object.assign(geoJSONFeature.properties, styleProps);
                    }
                }
                
                geoJSON.features.push(geoJSONFeature);
            });
            
            const dataStr = JSON.stringify(geoJSON, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            
            const fileName = assistFile.name.replace(/\.[^/.]+$/, '') + '_导出.geojson';
            
            const link = document.createElement('a');
            link.setAttribute('href', dataUri);
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showMessage(`导出成功: ${fileName}`, 'success');
        } catch (error) {
            console.error('导出失败:', error);
            showMessage('导出失败: ' + error.message, 'error');
        }
    }
    
    // 移除辅助元素文件
    function removeAssistFile(assistId) {
        const assistFileIndex = AppState.assistFiles.findIndex(f => f.id === assistId);
        if (assistFileIndex === -1) return;
        
        const assistFile = AppState.assistFiles[assistFileIndex];
        const features = AppState.assistFeatureMap.get(assistId) || [];
        
        if (!confirm(`确定要移除辅助元素文件 "${assistFile.name}" 吗？这将删除该文件及其 ${features.length} 个要素，此操作不可恢复。`)) {
            return;
        }
        
        // 从数据源中移除所有相关要素
        features.forEach(feature => {
            const geometryType = feature.getGeometry().getType();
            if (geometryType === 'LineString') {
                lineSource.removeFeature(feature);
            } else if (geometryType === 'Polygon') {
                assistPolygonSource.removeFeature(feature);
            } else if (geometryType === 'Point') {
                if (feature.get('iconType')) {
                    assistPointSource.removeFeature(feature);
                } else {
                    assistTextSource.removeFeature(feature);
                }
            }
        });
        
        // 从映射中删除
        AppState.assistFeatureMap.delete(assistId);
        
        // 从隐藏列表中删除
        AppState.hiddenAssistFiles.delete(assistId);
        
        // 从文件列表中删除
        AppState.assistFiles.splice(assistFileIndex, 1);
        
        // 如果删除的是当前选中的文件
        if (AppState.selectedAssistFile && AppState.selectedAssistFile.id === assistId) {
            AppState.selectedAssistFile = null;
        }
        
        updateAssistFileList();
        updateToggleAllAssistButton();
        updateStatus();
        
        console.log(`移除辅助元素文件: ${assistFile.name}`);
        showMessage(`已移除辅助元素文件 "${assistFile.name}"`, 'success');
    }
    
    // 辅助元素文件搜索功能
    function handleAssistFileSearch() {
        const searchTerm = $('#assistFileSearchInput').val().trim();
        updateAssistFileList(searchTerm);
    }
    
    // 清除辅助元素文件搜索
    function clearAssistFileSearch() {
        $('#assistFileSearchInput').val('');
        updateAssistFileList();
    }
    
    // 导入单个辅助元素文件
    function importAssistFile() {
        $('#assistGeoJSONFile').click();
    }
    
    // 导入辅助元素文件夹
    function importAssistFolder() {
        $('#assistGeoJSONFolder').click();
    }
    
    // 文件搜索功能
    function handleFileSearch() {
        const searchTerm = $('#fileSearchInput').val().trim();
        updateJSONFileList(searchTerm);
    }
    
    // 清除文件搜索
    function clearFileSearch() {
        $('#fileSearchInput').val('');
        updateJSONFileList();
    }
    
    // 选择JSON文件
    function selectJSONFile(jsonId) {
        // 清除之前的选择状态
        AppState.selectedFeature = null;
        if (selectInteraction) {
            selectInteraction.getFeatures().clear();
        }
        
        // 查找选中的JSON文件
        const jsonFile = AppState.jsonFiles.find(f => f.id === jsonId);
        if (!jsonFile) return;
        
        AppState.selectedJSONFile = jsonFile;
        
        // 更新所有要素的样式（非选中文件的要素显示为灰色）
        updateAllFeatureStyles();
        
        // 高亮显示该JSON文件中的所有多边形
        const features = AppState.jsonFeatureMap.get(jsonId) || [];
        if (features.length > 0) {
            // 缩放到该JSON文件的范围
            const extent = ol.extent.createEmpty();
            features.forEach(feature => {
                const geometry = feature.getGeometry();
                if (geometry) {
                    ol.extent.extend(extent, geometry.getExtent());
                }
            });
            
            if (extent && extent[0] !== Infinity) {
                map.getView().fit(extent, {
                    padding: [50, 50, 50, 50],
                    maxZoom: 15,
                    duration: 800
                });
            }
        }
        
        updateJSONFileList();
        updateStatus();
        
        console.log(`选中JSON文件: ${jsonFile.name}, 包含 ${features.length} 个多边形`);
    }
    
    // 更新所有要素的样式
    function updateAllFeatureStyles() {
        if (!vectorSource) return;
        
        vectorSource.getFeatures().forEach(feature => {
            feature.changed();
        });
    }
    
    // 清除JSON文件中的所有图形（保留文件）
    function clearJSONFile(jsonId) {
        const jsonFile = AppState.jsonFiles.find(f => f.id === jsonId);
        if (!jsonFile) return;
        
        const features = AppState.jsonFeatureMap.get(jsonId) || [];
        if (features.length === 0) {
            showMessage('该学区中没有图形可清除', 'warning');
            return;
        }
        
        if (!confirm(`确定要清除 "${jsonFile.name}" 中的所有 ${features.length} 个图形吗？`)) {
            return;
        }
        
        // 从数据源中移除所有相关要素
        features.forEach(feature => {
            vectorSource.removeFeature(feature);
            // 清除名称记录
            const featureId = feature.getId();
            if (AppState.polygonNames[featureId]) {
                delete AppState.polygonNames[featureId];
            }
        });
        
        // 清空该文件的要素列表
        AppState.jsonFeatureMap.set(jsonId, []);
        jsonFile.featureCount = 0;
        
        // 清除当前选中的要素（如果它属于该文件）
        if (AppState.selectedFeature) {
            const selectedFileId = AppState.selectedFeature.get('sourceFileId');
            if (selectedFileId === jsonId) {
                AppState.selectedFeature = null;
            }
        }
        
        updateJSONFileList();
        updateStatus();
        
        console.log(`清除学区图形: ${jsonFile.name}`);
        showMessage(`已清除 "${jsonFile.name}" 中的所有图形`, 'success');
    }
    
    // 移除JSON文件（删除文件和所有图形）
    function removeJSONFile(jsonId) {
        const jsonFileIndex = AppState.jsonFiles.findIndex(f => f.id === jsonId);
        if (jsonFileIndex === -1) return;
        
        const jsonFile = AppState.jsonFiles[jsonFileIndex];
        const features = AppState.jsonFeatureMap.get(jsonId) || [];
        
        if (!confirm(`确定要移除学区 "${jsonFile.name}" 吗？这将删除该学区及其 ${features.length} 个图形，此操作不可恢复。`)) {
            return;
        }
        
        // 从数据源中移除所有相关要素
        features.forEach(feature => {
            vectorSource.removeFeature(feature);
            // 清除名称记录
            const featureId = feature.getId();
            if (AppState.polygonNames[featureId]) {
                delete AppState.polygonNames[featureId];
            }
        });
        
        // 从映射中删除
        AppState.jsonFeatureMap.delete(jsonId);
        
        // 从隐藏列表中删除
        AppState.hiddenFiles.delete(jsonId);
        
        // 从标星列表中删除
        AppState.starredFiles.delete(jsonId);
        
        // 从文件列表中删除
        AppState.jsonFiles.splice(jsonFileIndex, 1);
        
        // 如果删除的是当前选中的文件，需要重新选择
        if (AppState.selectedJSONFile && AppState.selectedJSONFile.id === jsonId) {
            AppState.selectedJSONFile = null;
            AppState.selectedFeature = null;
            
            // 如果还有其他文件，自动选择第一个
            if (AppState.jsonFiles.length > 0) {
                selectJSONFile(AppState.jsonFiles[0].id);
            }
        }
        
        updateJSONFileList();
        updateStatus();
        updateToggleAllButton();
        
        console.log(`移除学区: ${jsonFile.name}`);
        showMessage(`已移除学区 "${jsonFile.name}"`, 'success');
    }
    
    // ========== 地图初始化 ==========
    function initMap() {
        console.log('初始化地图...');
        
        try {
            if (typeof ol === 'undefined') {
                throw new Error('OpenLayers未加载');
            }
            
            // 天地图图层 - 矢量地图
            const vecLayer = new ol.layer.Tile({
                source: new ol.source.XYZ({
                    url: `https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TiandituKeyManager.getCurrentKey()}`,
                    attributions: '© 天地图'
                }),
                visible: true
            });
            
            const cvaLayer = new ol.layer.Tile({
                source: new ol.source.XYZ({
                    url: `https://t0.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TiandituKeyManager.getCurrentKey()}`,
                    attributions: '© 天地图'
                }),
                visible: true
            });
            
            // 天地图图层 - 影像地图（卫星图）
            const imgLayer = new ol.layer.Tile({
                source: new ol.source.XYZ({
                    url: `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TiandituKeyManager.getCurrentKey()}`,
                    attributions: '© 天地图'
                }),
                visible: false,  // 默认不显示
                opacity: 1.0    // 默认完全不透明
            });
            
            // 天地图影像注记图层
            const ciaLayer = new ol.layer.Tile({
                source: new ol.source.XYZ({
                    url: `https://t0.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TiandituKeyManager.getCurrentKey()}`,
                    attributions: '© 天地图'
                }),
                visible: false,  // 默认不显示，跟随影像图层
                opacity: 1.0
            });
            
            // 多边形图层
            vectorSource = new ol.source.Vector();
            const vectorLayer = new ol.layer.Vector({
                source: vectorSource,
                style: function(feature) {
                    const name = feature.get('name') || '';
                    const isSelected = feature === AppState.selectedFeature;
                    const featureFileId = feature.get('sourceFileId');
                    const isInSelectedFile = AppState.selectedJSONFile && 
                                             AppState.selectedJSONFile.id === featureFileId;
                    
                    // 如果文件被隐藏，不显示该要素
                    if (featureFileId && AppState.hiddenFiles.has(featureFileId)) {
                        return null; // 返回null使要素不可见
                    }
                    
                    // 如果要素不属于当前选中的文件，显示为灰色禁用状态，但仍显示文字
                    if (!isInSelectedFile && AppState.selectedJSONFile) {
                        const styles = [
                            new ol.style.Style({
                                fill: new ol.style.Fill({
                                    color: 'rgba(189, 189, 189, 0.3)'
                                }),
                                stroke: new ol.style.Stroke({
                                    color: '#9e9e9e',
                                    width: 1,
                                    lineDash: [5, 5]
                                })
                            })
                        ];
                        
                        // 如果多边形有名称，添加文本标签（灰色状态也要显示）
                        if (name) {
                            const geometry = feature.getGeometry();
                            if (geometry && geometry.getType() === 'Polygon') {
                                const extent = geometry.getExtent();
                                const center = ol.extent.getCenter(extent);
                                
                                styles.push(
                                    new ol.style.Style({
                                        geometry: new ol.geom.Point(center),
                                        text: new ol.style.Text({
                                            text: name,
                                            font: 'bold 14px Arial',
                                            fill: new ol.style.Fill({
                                                color: '#757575'
                                            }),
                                            stroke: new ol.style.Stroke({
                                                color: 'white',
                                                width: 3
                                            })
                                        })
                                    })
                                );
                            }
                        }
                        
                        return styles;
                    }
                    
                    const styles = [
                        new ol.style.Style({
                            fill: new ol.style.Fill({
                                color: isSelected ? 'rgba(231, 76, 60, 0.4)' : 'rgba(52, 152, 219, 0.3)'
                            }),
                            stroke: new ol.style.Stroke({
                                color: isSelected ? '#e74c3c' : '#3498db',
                                width: isSelected ? 3 : 2
                            })
                        })
                    ];
                    
                    // 如果多边形有名称，添加文本标签
                    if (name) {
                        const geometry = feature.getGeometry();
                        if (geometry && geometry.getType() === 'Polygon') {
                            const extent = geometry.getExtent();
                            const center = ol.extent.getCenter(extent);
                            
                            styles.push(
                                new ol.style.Style({
                                    geometry: new ol.geom.Point(center),
                                    text: new ol.style.Text({
                                        text: name,
                                        font: 'bold 14px Arial',
                                        fill: new ol.style.Fill({
                                            color: isInSelectedFile ? '#2c3e50' : '#757575'
                                        }),
                                        stroke: new ol.style.Stroke({
                                            color: 'white',
                                            width: 3
                                        })
                                    })
                                })
                            );
                        }
                    }
                    
                    return styles;
                }
            });
            
            // 辅助线图层
            lineSource = new ol.source.Vector();
            const lineLayer = new ol.layer.Vector({
                source: lineSource,
                style: function(feature) {
                    // 检查是否属于隐藏的文件
                    const assistFileId = feature.get('assistFileId');
                    if (assistFileId && AppState.hiddenAssistFiles.has(assistFileId)) {
                        return null;
                    }
                    
                    // 检查要素是否有自定义样式（从GeoJSON导入的样式）
                    const customStyle = feature.getStyle();
                    if (customStyle) {
                        return customStyle;
                    }
                    
                    // 否则使用默认样式
                    return new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: '#e74c3c',
                            width: 2,
                            lineDash: [5, 5]
                        })
                    });
                }
            });
            
            // 辅助多边形图层
            assistPolygonSource = new ol.source.Vector();
            const assistPolygonLayer = new ol.layer.Vector({
                source: assistPolygonSource,
                style: function(feature) {
                    // 检查是否属于隐藏的文件
                    const assistFileId = feature.get('assistFileId');
                    if (assistFileId && AppState.hiddenAssistFiles.has(assistFileId)) {
                        return null;
                    }
                    
                    // 检查要素是否有自定义样式（从GeoJSON导入的样式）
                    const customStyle = feature.getStyle();
                    if (customStyle) {
                        // 如果有自定义样式，需要额外添加文字标签
                        const name = feature.get('name');
                        if (name) {
                            const styles = Array.isArray(customStyle) ? customStyle : [customStyle];
                            const geometry = feature.getGeometry();
                            if (geometry && geometry.getType() === 'Polygon') {
                                const extent = geometry.getExtent();
                                const center = ol.extent.getCenter(extent);
                                
                                styles.push(
                                    new ol.style.Style({
                                        geometry: new ol.geom.Point(center),
                                        text: new ol.style.Text({
                                            text: name,
                                            font: 'bold 14px Arial',
                                            fill: new ol.style.Fill({
                                                color: '#9b59b6'
                                            }),
                                            stroke: new ol.style.Stroke({
                                                color: 'white',
                                                width: 3
                                            })
                                        })
                                    })
                                );
                            }
                            return styles;
                        }
                        return customStyle;
                    }
                    
                    // 否则使用默认样式
                    const styles = [
                        new ol.style.Style({
                            fill: new ol.style.Fill({
                                color: 'rgba(155, 89, 182, 0.2)'
                            }),
                            stroke: new ol.style.Stroke({
                                color: '#9b59b6',
                                width: 2,
                                lineDash: [8, 4]
                            })
                        })
                    ];
                    
                    // 如果有名称，在多边形中心显示文字
                    const name = feature.get('name');
                    if (name) {
                        const geometry = feature.getGeometry();
                        if (geometry && geometry.getType() === 'Polygon') {
                            const extent = geometry.getExtent();
                            const center = ol.extent.getCenter(extent);
                            
                            styles.push(
                                new ol.style.Style({
                                    geometry: new ol.geom.Point(center),
                                    text: new ol.style.Text({
                                        text: name,
                                        font: 'bold 14px Arial',
                                        fill: new ol.style.Fill({
                                            color: '#9b59b6'
                                        }),
                                        stroke: new ol.style.Stroke({
                                            color: 'white',
                                            width: 3
                                        })
                                    })
                                })
                            );
                        }
                    }
                    
                    return styles;
                }
            });
            
            // 辅助文字图层
            assistTextSource = new ol.source.Vector();
            const assistTextLayer = new ol.layer.Vector({
                source: assistTextSource,
                style: function(feature) {
                    // 检查是否属于隐藏的文件
                    const assistFileId = feature.get('assistFileId');
                    if (assistFileId && AppState.hiddenAssistFiles.has(assistFileId)) {
                        return null;
                    }
                    
                    // 检查要素是否有自定义样式（从GeoJSON导入的样式）
                    const customStyle = feature.getStyle();
                    if (customStyle) {
                        return customStyle;
                    }
                    
                    // 否则使用默认样式
                    return new ol.style.Style({
                        text: new ol.style.Text({
                            text: feature.get('text') || '',
                            font: 'bold 16px Arial',
                            fill: new ol.style.Fill({
                                color: '#e67e22'
                            }),
                            stroke: new ol.style.Stroke({
                                color: 'white',
                                width: 4
                            }),
                            offsetY: -15
                        })
                    });
                }
            });
            
            // 辅助点图层（使用图标 + 可选文字）
            assistPointSource = new ol.source.Vector();
            const assistPointLayer = new ol.layer.Vector({
                source: assistPointSource,
                style: function(feature) {
                    // 检查是否属于隐藏的文件
                    const assistFileId = feature.get('assistFileId');
                    if (assistFileId && AppState.hiddenAssistFiles.has(assistFileId)) {
                        return null;
                    }
                    
                    const iconType = feature.get('iconType') || 'default';
                    const iconColor = feature.get('iconColor') || '#e74c3c';
                    const iconSize = feature.get('iconSize') || 1.0;
                    const text = feature.get('text');
                    const textColor = feature.get('textColor') || '#333333';
                    
                    // 根据图标类型返回不同样式
                    let iconChar = '📍'; // 默认位置标记
                    let iconScale = 1.2 * iconSize;
                    
                    switch(iconType) {
                        case 'home': iconChar = '🏠'; break;
                        case 'school': iconChar = '🏫'; break;
                        case 'hospital': iconChar = '🏥'; break;
                        case 'shop': iconChar = '🏪'; break;
                        case 'restaurant': iconChar = '🍽️'; break;
                        case 'park': iconChar = '🌳'; break;
                        case 'bus': iconChar = '🚌'; break;
                        case 'car': iconChar = '🚗'; break;
                        case 'flag': iconChar = '🚩'; break;
                        case 'star': iconChar = '⭐'; break;
                        case 'warning': iconChar = '⚠️'; break;
                        case 'info': iconChar = 'ℹ️'; break;
                        default: iconChar = '📍';
                    }
                    
                    // 构建样式数组
                    const styles = [];
                    
                    // 1. 图标样式
                    styles.push(new ol.style.Style({
                        text: new ol.style.Text({
                            text: iconChar,
                            font: `${14 * iconScale}px Arial`,
                            fill: new ol.style.Fill({
                                color: iconColor
                            }),
                            stroke: new ol.style.Stroke({
                                color: 'white',
                                width: 2
                            }),
                            offsetY: 0
                        }),
                        // 添加一个圆形背景以提高可见性
                        image: new ol.style.Circle({
                            radius: 12 * iconScale,
                            fill: new ol.style.Fill({
                                color: 'rgba(255,255,255,0.3)'
                            }),
                            stroke: new ol.style.Stroke({
                                color: iconColor,
                                width: 1
                            })
                        })
                    }));
                    
                    // 2. 如果有文字，添加文字样式（显示在图标下方）
                    if (text) {
                        styles.push(new ol.style.Style({
                            text: new ol.style.Text({
                                text: text,
                                font: `bold ${12 * iconSize}px Arial`,
                                fill: new ol.style.Fill({
                                    color: textColor
                                }),
                                stroke: new ol.style.Stroke({
                                    color: 'white',
                                    width: 3
                                }),
                                offsetY: 20 * iconSize, // 在图标下方显示
                                textAlign: 'center'
                            })
                        }));
                    }
                    
                    return styles;
                }
            });
            
            // 测量图层
            measureSource = new ol.source.Vector();
            measureLayer = new ol.layer.Vector({
                source: measureSource,
                style: new ol.style.Style({
                    fill: new ol.style.Fill({
                        color: 'rgba(255, 255, 255, 0.2)'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#ff6b6b',
                        width: 3,
                        lineDash: [10, 10]
                    }),
                    image: new ol.style.Circle({
                        radius: 6,
                        fill: new ol.style.Fill({
                            color: '#ff6b6b'
                        }),
                        stroke: new ol.style.Stroke({
                            color: 'white',
                            width: 2
                        })
                    })
                }),
                zIndex: 999
            });
            
            // 搜索结果图层
            searchSource = new ol.source.Vector();
            const searchLayer = new ol.layer.Vector({
                source: searchSource,
                style: new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 8,
                        fill: new ol.style.Fill({
                            color: '#2ecc71'
                        }),
                        stroke: new ol.style.Stroke({
                            color: 'white',
                            width: 2
                        })
                    })
                })
            });
            
            // 创建地图
            const view = new ol.View({
                center: ol.proj.fromLonLat(CONFIG.INITIAL_CENTER),
                zoom: CONFIG.INITIAL_ZOOM
            });
            
            map = new ol.Map({
                target: 'map',
                layers: [vecLayer, cvaLayer, imgLayer, ciaLayer, vectorLayer, lineLayer, assistPolygonLayer, assistTextLayer, assistPointLayer, measureLayer, searchLayer],
                view: view
            });
            
            // 存储图层引用
            window.mapLayers = {
                vecLayer: vecLayer,
                cvaLayer: cvaLayer,
                imgLayer: imgLayer,      // 影像图层
                ciaLayer: ciaLayer,      // 影像注记图层
                vectorLayer: vectorLayer,
                lineLayer: lineLayer,
                assistPolygonLayer: assistPolygonLayer,
                assistTextLayer: assistTextLayer,
                assistPointLayer: assistPointLayer,
                measureLayer: measureLayer, // 测量图层
                searchLayer: searchLayer
            };
            
            // 初始化交互
            initInteractions();
            
            // 添加鼠标悬停显示地址功能
            initMouseHoverHandler();
            
            console.log('地图初始化完成');
            showMessage('地图加载成功！', 'success');
            
        } catch (error) {
            console.error('地图初始化失败:', error);
            showMessage('地图初始化失败: ' + error.message, 'error');
        }
    }
    
    // ========== 鼠标悬停处理 ==========
    function initMouseHoverHandler() {
        const hoverAddressContainer = $('<div id="hoverAddressDisplay"></div>');
        $('.map-container').append(hoverAddressContainer);
        
        const mapElement = map.getViewport();
        
        mapElement.addEventListener('mousemove', function(event) {
            // 使用 OpenLayers 提供的 getEventPixel 方法，自动处理坐标转换
            const pixel = map.getEventPixel(event);
            const coordinate = map.getCoordinateFromPixel(pixel);
            if (!coordinate) return;
            
            const lonLat = ol.proj.toLonLat(coordinate);
            
            if (AppState.hoverTimer) {
                clearTimeout(AppState.hoverTimer);
                AppState.hoverTimer = null;
            }
            
            AppState.lastHoverCoordinate = lonLat;
            
            AppState.hoverTimer = setTimeout(function() {
                if (AppState.hoverRequestCount >= CONFIG.MAX_HOVER_REQUESTS) {
                    return;
                }
                
                hoverAddressContainer.html(`
                    <div style="font-weight:bold;margin-bottom:3px;color:#3498db;">鼠标位置</div>
                    <div>坐标: ${lonLat[0].toFixed(6)}, ${lonLat[1].toFixed(6)}</div>
                    <div style="font-size:11px;color:#666;">正在获取地址...</div>
                `).show();
                
                AppState.hoverRequestCount++;
                reverseGeocodeForHover(lonLat[0], lonLat[1], hoverAddressContainer);
                
            }, CONFIG.HOVER_DELAY);
        });
        
        mapElement.addEventListener('mouseleave', function() {
            if (AppState.hoverTimer) {
                clearTimeout(AppState.hoverTimer);
                AppState.hoverTimer = null;
            }
            hoverAddressContainer.hide();
        });
        
        setInterval(function() {
            AppState.hoverRequestCount = 0;
        }, 1000);
    }
    
    function reverseGeocodeForHover(lon, lat, container) {
        let currentKey = TiandituKeyManager.getCurrentKey();
        
        const makeRequest = (key) => {
            const params = {
                postStr: JSON.stringify({
                    lon: lon.toFixed(6),
                    lat: lat.toFixed(6),
                    ver: '1'
                }),
                type: 'geocode',
                tk: key
            };
            
            const queryString = Object.keys(params)
                .map(key => `${key}=${encodeURIComponent(params[key])}`)
                .join('&');
            
            return fetch(`${CONFIG.REVERSE_GEOCODER_API}?${queryString}`)
                .then(response => response.json());
        };
        
        const tryRequest = (attempt = 0) => {
            makeRequest(currentKey)
                .then(data => {
                    // 检查是否因配额超限失败
                    if (data.status && (data.status === '7' || data.status === '100' || 
                        (data.msg && (data.msg.includes('limit') || data.msg.includes('配额'))))) {
                        if (attempt < TiandituKeyManager.keys.length - 1) {
                            console.warn(`[KEY轮换] 反向地理编码KEY超限，尝试下一个`);
                            currentKey = TiandituKeyManager.getNextKey();
                            tryRequest(attempt + 1);
                            return;
                        }
                    }
                    
                    if (data.status === "0" && data.result) {
                        const address = data.result.formatted_address || '未知地址';
                        const location = data.result.location || {};
                        
                        let addressText = address;
                        if (location.district) {
                            addressText = location.district + (location.street ? location.street : '');
                        }
                        
                        container.html(`
                            <div style="font-weight:bold;margin-bottom:3px;color:#3498db;">鼠标位置</div>
                            <div style="margin-bottom:2px;"><strong>坐标:</strong> ${lon.toFixed(6)}, ${lat.toFixed(6)}</div>
                            <div style="margin-bottom:2px;"><strong>地址:</strong> ${addressText}</div>
                        `);
                    } else {
                        container.html(`
                            <div style="font-weight:bold;margin-bottom:3px;color:#3498db;">鼠标位置</div>
                            <div style="margin-bottom:2px;"><strong>坐标:</strong> ${lon.toFixed(6)}, ${lat.toFixed(6)}</div>
                        `);
                    }
                    
                    setTimeout(function() {
                        if (AppState.hoverRequestCount > 0) {
                            AppState.hoverRequestCount--;
                        }
                    }, 5000);
                })
                .catch(error => {
                    console.error('[反向地理编码] 请求失败:', error);
                    // 尝试下一个KEY
                    if (attempt < TiandituKeyManager.keys.length - 1) {
                        currentKey = TiandituKeyManager.getNextKey();
                        tryRequest(attempt + 1);
                        return;
                    }
                    
                    container.html(`
                        <div style="font-weight:bold;margin-bottom:3px;color:#3498db;">鼠标位置</div>
                        <div style="margin-bottom:2px;"><strong>坐标:</strong> ${lon.toFixed(6)}, ${lat.toFixed(6)}</div>
                    `);
                    
                    setTimeout(function() {
                        if (AppState.hoverRequestCount > 0) {
                            AppState.hoverRequestCount--;
                        }
                    }, 5000);
                });
        };
        
        tryRequest();
    }
    
    // ========== 交互初始化 ==========
    function initInteractions() {
        // 选择交互 - 使用条件函数来限制选择
        selectInteraction = new ol.interaction.Select({
            layers: [window.mapLayers.vectorLayer],
            filter: function(feature, layer) {
                // 如果当前没有选中的文件，不允许选择任何要素
                if (!AppState.selectedJSONFile) {
                    return false;
                }
                
                // 只允许选择当前选中文件的要素
                const featureFileId = feature.get('sourceFileId');
                return featureFileId === AppState.selectedJSONFile.id;
            }
        });
        
        selectInteraction.on('select', function(event) {
            if (event.selected.length > 0) {
                const feature = event.selected[0];
                AppState.selectedFeature = feature;
            } else {
                AppState.selectedFeature = null;
            }
            updateStatus();
        });
        
        map.addInteraction(selectInteraction);
        
        // 辅助要素选择交互
        initAssistSelectInteraction();
        
        // 辅助多边形编辑交互
        initAssistPolygonModifyInteraction();
        
        // 修改交互 - 只允许修改当前选中文件的要素
        modifyInteraction = new ol.interaction.Modify({
            source: vectorSource,
            style: new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 7,
                    fill: new ol.style.Fill({
                        color: '#e74c3c'
                    }),
                    stroke: new ol.style.Stroke({
                        color: 'white',
                        width: 2
                    })
                })
            }),
            pixelTolerance: 15,
            condition: function(event) {
                // 只允许编辑当前选中文件的要素
                const feature = selectInteraction.getFeatures().item(0);
                if (!feature || !AppState.selectedJSONFile) {
                    return false;
                }
                const featureFileId = feature.get('sourceFileId');
                if (featureFileId !== AppState.selectedJSONFile.id) {
                    return false;
                }
                return ol.events.condition.primaryAction(event);
            }
        });
        
        // 监听修改开始事件来追踪顶点
        modifyInteraction.on('modifystart', function(event) {
            if (event.mapBrowserEvent) {
                const pixel = event.mapBrowserEvent.pixel;
                findAndHighlightNearestVertex(pixel);
            }
        });
        
        // 添加pointerdown事件监听，即使用户不拖动也能选中顶点
        map.on('pointerdown', function(event) {
            if (AppState.currentMode === 'editPolygon' && AppState.selectedFeature) {
                // 检查是否点击了顶点
                const pixel = event.pixel;
                const vertexIndex = findAndHighlightNearestVertex(pixel);
                
                if (vertexIndex >= 0) {
                    console.log('通过点击选中顶点:', vertexIndex);
                }
            }
        });
        
        modifyInteraction.on('modifyend', function(event) {
            console.log('修改结束');
            if (event.features && event.features.getArray) {
                event.features.getArray().forEach(function(feature) {
                    feature.changed();
                });
            }
        });
        
        modifyInteraction.setActive(false);
        map.addInteraction(modifyInteraction);
        
        // 添加键盘事件监听器
        initKeyboardEvents();
        
        // 设置辅助多边形顶点删除处理器（使用原生DOM事件）
        setupAssistVertexDeleteHandler();
    }
    
    // ========== 辅助多边形编辑交互 ==========
    function initAssistPolygonModifyInteraction() {
        // 创建辅助多边形编辑交互
        assistPolygonModifyInteraction = new ol.interaction.Modify({
            source: assistPolygonSource,
            style: new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 7,
                    fill: new ol.style.Fill({
                        color: '#e74c3c'
                    }),
                    stroke: new ol.style.Stroke({
                        color: 'white',
                        width: 2
                    })
                })
            }),
            pixelTolerance: 15,
            condition: function(event) {
                // 只允许在辅助多边形编辑模式下编辑
                if (AppState.currentMode !== 'editAssistPolygon') {
                    return false;
                }
                return ol.events.condition.primaryAction(event);
            }
        });
        
        assistPolygonModifyInteraction.on('modifyend', function(event) {
            console.log('辅助多边形编辑结束');
            if (event.features && event.features.getArray) {
                event.features.getArray().forEach(function(feature) {
                    feature.changed();
                });
            }
            // 编辑完成后重置顶点选择
            AppState.selectedAssistVertexIndex = null;
            AppState.selectedAssistVertexCoordinates = null;
        });
        
        // 添加修改开始事件监听，用于追踪顶点
        // 记录当前正在编辑的顶点索引
        let currentModifyingVertexIndex = null;
        
        assistPolygonModifyInteraction.on('modifystart', function(event) {
            console.log('辅助多边形编辑开始');
            if (event.mapBrowserEvent) {
                const pixel = event.mapBrowserEvent.pixel;
                const vertexIndex = findAndHighlightAssistVertex(pixel);
                if (vertexIndex >= 0) {
                    currentModifyingVertexIndex = vertexIndex;
                    console.log('开始编辑顶点:', vertexIndex);
                }
            }
        });
        
        assistPolygonModifyInteraction.on('modifyend', function(event) {
            // 编辑结束后清除当前编辑的顶点记录
            currentModifyingVertexIndex = null;
        });
        
        assistPolygonModifyInteraction.setActive(false);
        map.addInteraction(assistPolygonModifyInteraction);
        
        assistPolygonModifyInteraction.setActive(false);
        map.addInteraction(assistPolygonModifyInteraction);
    }
    
    // ========== 终极方案：使用原生 DOM 事件监听 ==========
    // 在地图初始化完成后调用此函数设置全局事件监听
    function setupAssistVertexDeleteHandler() {
        const viewport = map.getViewport();
        
        // 双击删除
        viewport.addEventListener('dblclick', function(event) {
            if (AppState.currentMode !== 'editAssistPolygon' || !AppState.selectedAssistFeature) {
                return;
            }
            
            console.log('【DOM】双击事件触发');
            const pixel = map.getEventPixel(event);
            const vertexIndex = findNearestAssistVertex(pixel);
            
            if (vertexIndex >= 0) {
                console.log('【DOM】双击删除顶点:', vertexIndex);
                deleteAssistVertexByIndex(vertexIndex);
            }
        });
        
        // 右键删除
        viewport.addEventListener('contextmenu', function(event) {
            if (AppState.currentMode !== 'editAssistPolygon' || !AppState.selectedAssistFeature) {
                return;
            }
            
            event.preventDefault();
            console.log('【DOM】右键事件触发');
            const pixel = map.getEventPixel(event);
            const vertexIndex = findNearestAssistVertex(pixel);
            
            if (vertexIndex >= 0) {
                console.log('【DOM】右键删除顶点:', vertexIndex);
                deleteAssistVertexByIndex(vertexIndex);
            } else {
                showMessage('请右键点击顶点进行删除', 'info');
            }
        });
        
        // Alt+点击删除（另一种选择）
        viewport.addEventListener('click', function(event) {
            if (AppState.currentMode !== 'editAssistPolygon' || !AppState.selectedAssistFeature) {
                return;
            }
            
            // 检查是否按下了 Alt 键
            if (!event.altKey) {
                return;
            }
            
            console.log('【DOM】Alt+点击事件触发');
            const pixel = map.getEventPixel(event);
            const vertexIndex = findNearestAssistVertex(pixel);
            
            if (vertexIndex >= 0) {
                console.log('【DOM】Alt+点击删除顶点:', vertexIndex);
                deleteAssistVertexByIndex(vertexIndex);
            }
        });
        
        console.log('辅助多边形顶点删除处理器已设置完成');
    }
    
    // 直接删除指定索引的顶点（不依赖预选）
    function deleteAssistVertexByIndex(vertexIndex) {
        if (!AppState.selectedAssistFeature) {
            showMessage('请先选择辅助多边形', 'warning');
            return;
        }
        
        const geometry = AppState.selectedAssistFeature.getGeometry();
        if (!geometry || geometry.getType() !== 'Polygon') {
            showMessage('选中的要素不是辅助多边形', 'error');
            return;
        }
        
        const coordinates = geometry.getCoordinates()[0];
        
        // 检查顶点数量
        if (coordinates.length <= 4) {
            showMessage('辅助多边形至少需要3个顶点，无法删除', 'warning');
            return;
        }
        
        // 验证索引
        if (vertexIndex < 0 || vertexIndex >= coordinates.length - 1) {
            showMessage('无效的顶点索引', 'error');
            return;
        }
        
        // 删除顶点
        coordinates.splice(vertexIndex, 1);
        coordinates[coordinates.length - 1] = coordinates[0].slice();
        geometry.setCoordinates([coordinates]);
        
        AppState.selectedAssistFeature.changed();
        
        // 显示成功消息
        showMessage(`顶点 ${vertexIndex + 1} 已删除，剩余 ${coordinates.length - 1} 个顶点`, 'success');
        console.log('顶点删除成功:', vertexIndex);
        
        updateStatus();
    }
    
    // 辅助函数：找到最近的顶点索引（不设置选中状态）
    function findNearestAssistVertex(pixel) {
        if (!AppState.selectedAssistFeature || AppState.currentMode !== 'editAssistPolygon') {
            return -1;
        }
        
        const geometry = AppState.selectedAssistFeature.getGeometry();
        if (!geometry || geometry.getType() !== 'Polygon') return -1;
        
        const coordinates = geometry.getCoordinates()[0];
        const clickCoord = map.getCoordinateFromPixel(pixel);
        
        if (!clickCoord) return -1;
        
        let minDistance = Infinity;
        let closestIndex = -1;
        
        for (let i = 0; i < coordinates.length - 1; i++) {
            const vertex = coordinates[i];
            const distance = Math.sqrt(
                Math.pow(vertex[0] - clickCoord[0], 2) + 
                Math.pow(vertex[1] - clickCoord[1], 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        }
        
        const resolution = map.getView().getResolution();
        const threshold = resolution * 40; // 40像素的阈值，更容易命中
        
        if (minDistance < threshold && closestIndex >= 0) {
            return closestIndex;
        }
        
        return -1;
    }
    
    // 切换辅助多边形编辑模式
    function toggleAssistPolygonEdit() {
        if (AppState.currentMode === 'editAssistPolygon') {
            stopAssistPolygonEdit();
        } else {
            startAssistPolygonEdit();
        }
    }
    
    // 开始辅助多边形编辑
    function startAssistPolygonEdit() {
        // 检查是否选中了辅助多边形
        if (!AppState.selectedAssistFeature) {
            showMessage('请先选择要编辑的辅助多边形', 'warning');
            return;
        }
        
        // 检查选中的要素是否是辅助多边形
        const geometryType = AppState.selectedAssistFeature.getGeometry().getType();
        if (geometryType !== 'Polygon') {
            showMessage('只能编辑辅助多边形', 'warning');
            return;
        }
        
        // 获取顶点数量
        const geometry = AppState.selectedAssistFeature.getGeometry();
        const coordinates = geometry.getCoordinates()[0];
        const vertexCount = coordinates.length - 1; // 减去闭合点
        
        // 停止其他模式（但保留辅助要素选择）
        stopDrawing();
        stopEditPolygon();
        // 不调用 stopAssistSelectMode()，保留选中的辅助多边形
        
        // 将选中的辅助多边形添加到编辑交互中
        if (assistPolygonModifyInteraction) {
            // 先禁用选择交互，避免冲突
            if (assistSelectInteraction) {
                assistSelectInteraction.setActive(false);
                // 关键修复：清除选择交互内部的选中集合，避免干扰事件
                assistSelectInteraction.getFeatures().clear();
            }
            
            assistPolygonModifyInteraction.setActive(true);
        }
        
        AppState.currentMode = 'editAssistPolygon';
        updateToolbarButtons();
        updateStatus();
        
        // 显示删除顶点提示
        showDeleteVertexHint(true);
        
        showMessage(`辅助多边形编辑模式已激活。当前有 ${vertexCount} 个顶点。拖动顶点调整形状，点击顶点选中后可删除，按 ESC 退出编辑`, 'info');
    }
    
    // 停止辅助多边形编辑
    function stopAssistPolygonEdit() {
        if (assistPolygonModifyInteraction) {
            assistPolygonModifyInteraction.setActive(false);
        }
        
        // 重新激活辅助要素选择交互
        if (assistSelectInteraction) {
            assistSelectInteraction.setActive(true);
        }
        
        // 重置顶点选择
        AppState.selectedAssistVertexIndex = null;
        AppState.selectedAssistVertexCoordinates = null;
        
        // 清除顶点高亮
        clearVertexHighlight();
        
        // 隐藏删除顶点提示
        showDeleteVertexHint(false);
        
        // 回到辅助要素选择模式，如果有选中的要素
        if (AppState.selectedAssistFeature) {
            AppState.currentMode = 'assistSelect';
        } else {
            AppState.currentMode = 'browse';
        }
        
        updateToolbarButtons();
        updateStatus();
    }
    
    // 显示/隐藏删除顶点提示
    function showDeleteVertexHint(show) {
        const $hint = $('#deleteVertexHint');
        if ($hint.length) {
            $hint.css('display', show ? 'block' : 'none');
        }
    }
    
    // 查找并高亮显示辅助多边形最近的顶点
    function findAndHighlightAssistVertex(pixel) {
        console.log('findAndHighlightAssistVertex 被调用，像素位置:', pixel);
        console.log('  selectedAssistFeature:', AppState.selectedAssistFeature ? '存在' : '不存在');
        console.log('  currentMode:', AppState.currentMode);
        
        if (!AppState.selectedAssistFeature || AppState.currentMode !== 'editAssistPolygon') {
            console.log('  早期返回: 未选中要素或不在编辑模式');
            return -1;
        }
        
        const geometry = AppState.selectedAssistFeature.getGeometry();
        if (!geometry || geometry.getType() !== 'Polygon') {
            console.log('  早期返回: 几何类型错误');
            return -1;
        }
        
        const coordinates = geometry.getCoordinates()[0];
        const clickCoord = map.getCoordinateFromPixel(pixel);
        
        console.log('  点击坐标:', clickCoord);
        console.log('  多边形顶点数:', coordinates.length);
        
        if (!clickCoord) {
            console.log('  早期返回: 无法获取点击坐标');
            return -1;
        }
        
        // 找到最近的顶点
        let minDistance = Infinity;
        let closestIndex = -1;
        
        // 遍历所有顶点（不包括最后一个闭合点）
        for (let i = 0; i < coordinates.length - 1; i++) {
            const vertex = coordinates[i];
            const distance = Math.sqrt(
                Math.pow(vertex[0] - clickCoord[0], 2) + 
                Math.pow(vertex[1] - clickCoord[1], 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        }
        
        // 修复：增大阈值使其更容易选中顶点（从25像素增加到35像素）
        const resolution = map.getView().getResolution();
        const threshold = resolution * 35; // 35像素的地图单位，更容易选中
        
        if (minDistance < threshold && closestIndex >= 0) {
            AppState.selectedAssistVertexIndex = closestIndex;
            AppState.selectedAssistVertexCoordinates = coordinates[closestIndex];
            console.log('选中辅助多边形顶点索引:', closestIndex, '坐标:', coordinates[closestIndex], '距离:', minDistance, '阈值:', threshold);
            
            // 创建临时高亮效果来显示选中的顶点
            highlightSelectedVertex(coordinates[closestIndex]);
            
            // 显示视觉反馈
            showMessage(`已选中顶点 ${closestIndex + 1} / ${coordinates.length - 1}，按 Delete 键删除`, 'info');
            
            return closestIndex;
        }
        
        // 如果没有选中顶点，清除高亮
        clearVertexHighlight();
        return -1;
    }
    
    // 临时高亮图层，用于显示选中的顶点
    let vertexHighlightSource = null;
    let vertexHighlightLayer = null;
    
    // 高亮显示选中的顶点
    function highlightSelectedVertex(coordinate) {
        // 创建高亮图层（如果不存在）
        if (!vertexHighlightLayer) {
            vertexHighlightSource = new ol.source.Vector();
            vertexHighlightLayer = new ol.layer.Vector({
                source: vertexHighlightSource,
                style: new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 12,
                        fill: new ol.style.Fill({
                            color: 'rgba(231, 76, 60, 0.6)'
                        }),
                        stroke: new ol.style.Stroke({
                            color: '#e74c3c',
                            width: 3
                        })
                    })
                }),
                zIndex: 1001
            });
            map.addLayer(vertexHighlightLayer);
        }
        
        // 清除之前的高亮
        vertexHighlightSource.clear();
        
        // 添加新的高亮点
        const highlightFeature = new ol.Feature({
            geometry: new ol.geom.Point(coordinate)
        });
        vertexHighlightSource.addFeature(highlightFeature);
    }
    
    // 清除顶点高亮
    function clearVertexHighlight() {
        if (vertexHighlightSource) {
            vertexHighlightSource.clear();
        }
    }
    
    // 删除选中的辅助多边形顶点
    function deleteSelectedAssistVertex() {
        // 首先检查是否在编辑模式下
        if (AppState.currentMode !== 'editAssistPolygon') {
            showMessage('请先进入辅助多边形编辑模式', 'warning');
            return;
        }
        
        // 检查是否有选中的辅助多边形
        if (!AppState.selectedAssistFeature) {
            showMessage('请先选择辅助多边形', 'warning');
            return;
        }
        
        const geometry = AppState.selectedAssistFeature.getGeometry();
        if (!geometry || geometry.getType() !== 'Polygon') {
            showMessage('选中的要素不是辅助多边形', 'error');
            return;
        }
        
        const coordinates = geometry.getCoordinates()[0];
        
        // 检查顶点数量（至少4个点，因为多边形是闭合的，起点=终点）
        if (coordinates.length <= 4) {
            showMessage('辅助多边形至少需要3个顶点，无法删除', 'warning');
            return;
        }
        
        // 获取预选的顶点索引
        let vertexIndex = AppState.selectedAssistVertexIndex;
        
        // 修复：如果没有预选的顶点，尝试使用最后一个有效的顶点索引或提示用户
        if (vertexIndex === null || vertexIndex === undefined || vertexIndex < 0 || vertexIndex >= coordinates.length - 1) {
            showMessage('请先点击要删除的顶点，然后再按 Delete 键删除', 'warning');
            return;
        }
        
        // 记录被删除的顶点索引用于提示
        const deletedIndex = vertexIndex;
        
        // 删除指定索引的顶点
        coordinates.splice(vertexIndex, 1);
        
        // 更新最后一个点为第一个点（保持多边形闭合）
        coordinates[coordinates.length - 1] = coordinates[0].slice();
        
        geometry.setCoordinates([coordinates]);
        
        AppState.selectedAssistFeature.changed();
        
        // 清除顶点高亮
        clearVertexHighlight();
        
        // 重置顶点选择
        AppState.selectedAssistVertexIndex = null;
        AppState.selectedAssistVertexCoordinates = null;
        
        console.log('辅助多边形顶点删除成功，已删除顶点:', deletedIndex, '剩余顶点数:', coordinates.length - 1);
        showMessage(`顶点 ${deletedIndex + 1} 删除成功，剩余 ${coordinates.length - 1} 个顶点`, 'success');
        
        updateStatus();
    }
    
    // ========== 辅助要素选择交互 ==========
    function initAssistSelectInteraction() {
        // 创建辅助要素选择交互
        assistSelectInteraction = new ol.interaction.Select({
            layers: [window.mapLayers.lineLayer, window.mapLayers.assistPolygonLayer, window.mapLayers.assistTextLayer, window.mapLayers.assistPointLayer],
            style: function(feature) {
                const geometryType = feature.getGeometry().getType();
                
                if (geometryType === 'LineString') {
                    return new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: '#c0392b',
                            width: 4,
                            lineDash: [5, 5]
                        })
                    });
                } else if (geometryType === 'Polygon') {
                    const styles = [
                        new ol.style.Style({
                            fill: new ol.style.Fill({
                                color: 'rgba(192, 57, 43, 0.4)'
                            }),
                            stroke: new ol.style.Stroke({
                                color: '#c0392b',
                                width: 3,
                                lineDash: [8, 4]
                            })
                        })
                    ];
                    
                    // 选中状态也显示名称
                    const name = feature.get('name');
                    if (name) {
                        const geometry = feature.getGeometry();
                        const extent = geometry.getExtent();
                        const center = ol.extent.getCenter(extent);
                        
                        styles.push(
                            new ol.style.Style({
                                geometry: new ol.geom.Point(center),
                                text: new ol.style.Text({
                                    text: name,
                                    font: 'bold 14px Arial',
                                    fill: new ol.style.Fill({
                                        color: '#c0392b'
                                    }),
                                    stroke: new ol.style.Stroke({
                                        color: 'white',
                                        width: 3
                                    })
                                })
                            })
                        );
                    }
                    
                    return styles;
                } else if (geometryType === 'Point') {
                    const isTextFeature = feature.get('text') && !feature.get('iconType');
                    if (isTextFeature) {
                        // 辅助文字样式
                        return new ol.style.Style({
                            text: new ol.style.Text({
                                text: feature.get('text') || '',
                                font: 'bold 18px Arial',
                                fill: new ol.style.Fill({
                                    color: '#c0392b'
                                }),
                                stroke: new ol.style.Stroke({
                                    color: 'white',
                                    width: 4
                                }),
                                offsetY: -15
                            }),
                            image: new ol.style.Circle({
                                radius: 6,
                                fill: new ol.style.Fill({
                                    color: '#c0392b'
                                }),
                                stroke: new ol.style.Stroke({
                                    color: 'white',
                                    width: 2
                                })
                            })
                        });
                    } else {
                        // 辅助点样式（放大显示）- 支持图标+文字
                        const iconType = feature.get('iconType') || 'default';
                        const iconColor = feature.get('iconColor') || '#e74c3c';
                        const iconSize = feature.get('iconSize') || 1.0;
                        const text = feature.get('text');
                        const textColor = feature.get('textColor') || '#333333';
                        
                        let iconChar = '📍';
                        let iconScale = 1.5 * iconSize; // 选中时放大
                        
                        switch(iconType) {
                            case 'home': iconChar = '🏠'; break;
                            case 'school': iconChar = '🏫'; break;
                            case 'hospital': iconChar = '🏥'; break;
                            case 'shop': iconChar = '🏪'; break;
                            case 'restaurant': iconChar = '🍽️'; break;
                            case 'park': iconChar = '🌳'; break;
                            case 'bus': iconChar = '🚌'; break;
                            case 'car': iconChar = '🚗'; break;
                            case 'flag': iconChar = '🚩'; break;
                            case 'star': iconChar = '⭐'; break;
                            case 'warning': iconChar = '⚠️'; break;
                            case 'info': iconChar = 'ℹ️'; break;
                            default: iconChar = '📍';
                        }
                        
                        const styles = [];
                        
                        // 图标样式
                        styles.push(new ol.style.Style({
                            text: new ol.style.Text({
                                text: iconChar,
                                font: `${14 * iconScale}px Arial`,
                                fill: new ol.style.Fill({
                                    color: iconColor
                                }),
                                stroke: new ol.style.Stroke({
                                    color: 'white',
                                    width: 3
                                }),
                                offsetY: 0
                            }),
                            image: new ol.style.Circle({
                                radius: 14 * iconScale,
                                fill: new ol.style.Fill({
                                    color: 'rgba(231, 76, 60, 0.4)'
                                }),
                                stroke: new ol.style.Stroke({
                                    color: iconColor,
                                    width: 2
                                })
                            })
                        }));
                        
                        // 如果有文字，添加文字样式（选中时放大）
                        if (text) {
                            styles.push(new ol.style.Style({
                                text: new ol.style.Text({
                                    text: text,
                                    font: `bold ${14 * iconSize}px Arial`,
                                    fill: new ol.style.Fill({
                                        color: textColor
                                    }),
                                    stroke: new ol.style.Stroke({
                                        color: 'white',
                                        width: 3
                                    }),
                                    offsetY: 22 * iconSize,
                                    textAlign: 'center'
                                })
                            }));
                        }
                        
                        return styles;
                    }
                }
            }
        });
        
        assistSelectInteraction.on('select', function(event) {
            if (event.selected.length > 0) {
                AppState.selectedAssistFeature = event.selected[0];
                const geometryType = AppState.selectedAssistFeature.getGeometry().getType();
                let typeName = '辅助要素';
                let editHint = '';
                if (geometryType === 'LineString') {
                    typeName = '辅助线';
                } else if (geometryType === 'Polygon') {
                    typeName = '辅助多边形';
                    editHint = '（点击"编辑"按钮或双击可编辑形状）';
                } else if (geometryType === 'Point') {
                    const hasIcon = AppState.selectedAssistFeature.get('iconType');
                    const hasText = AppState.selectedAssistFeature.get('text');
                    
                    if (hasIcon && hasText) {
                        typeName = '辅助点(带文字)';
                    } else if (hasIcon) {
                        typeName = '辅助点';
                    } else {
                        typeName = '辅助文字';
                    }
                }
                
                // 同步选中对应的辅助元素文件列表项
                const assistFileId = AppState.selectedAssistFeature.get('assistFileId');
                if (assistFileId) {
                    // 检查当前选中的文件是否已经是该要素所属的文件
                    if (!AppState.selectedAssistFile || AppState.selectedAssistFile.id !== assistFileId) {
                        selectAssistFile(assistFileId);
                        // 滚动到选中的文件项
                        const $fileItem = $(`.assist-file-item[data-assist-id="${assistFileId}"]`);
                        if ($fileItem.length) {
                            const $fileList = $('#assistFileList');
                            $fileList.animate({
                                scrollTop: $fileItem.position().top + $fileList.scrollTop() - 10
                            }, 300);
                        }
                    }
                }
                
                showMessage(`已选中${typeName}${editHint}，点击删除按钮或按 Delete 键删除`, 'info');
            } else {
                AppState.selectedAssistFeature = null;
            }
            updateStatus();
        });
        
        // 添加双击事件监听，用于进入辅助多边形编辑模式
        map.on('dblclick', function(event) {
            if (AppState.currentMode === 'assistSelect' && AppState.selectedAssistFeature) {
                const geometryType = AppState.selectedAssistFeature.getGeometry().getType();
                if (geometryType === 'Polygon') {
                    event.preventDefault();
                    startAssistPolygonEdit();
                }
            }
        });
        
        assistSelectInteraction.setActive(false);
        map.addInteraction(assistSelectInteraction);
    }
    
    // ========== 键盘事件处理 ==========
    function initKeyboardEvents() {
        $(document).on('keydown', function(event) {
            // ESC键处理
            if (event.key === 'Escape') {
                if (AppState.isDrawing) {
                    stopDrawing();
                    showMessage('已取消绘制', 'info');
                } else if (AppState.currentMode === 'editPolygon') {
                    stopEditPolygon();
                    showMessage('已退出编辑模式', 'info');
                } else if (AppState.currentMode === 'editAssistPolygon') {
                    stopAssistPolygonEdit();
                    showMessage('已退出辅助多边形编辑模式', 'info');
                } else if (AppState.currentMode === 'assistSelect') {
                    stopAssistSelectMode();
                    showMessage('已退出辅助要素选择模式', 'info');
                }
            }
            
            // Delete键删除
            if ((event.key === 'Delete' || event.key === 'Del') && !event.ctrlKey && !event.altKey) {
                // 删除学区多边形顶点
                if (AppState.currentMode === 'editPolygon' && AppState.selectedFeature) {
                    event.preventDefault();
                    deleteSelectedVertex();
                }
                // 删除辅助多边形顶点（编辑模式下优先删除顶点）
                else if (AppState.currentMode === 'editAssistPolygon' && AppState.selectedAssistFeature) {
                    event.preventDefault();
                    // 如果有选中的顶点，删除顶点；否则提示用户先选择顶点
                    if (AppState.selectedAssistVertexIndex !== null && AppState.selectedAssistVertexIndex >= 0) {
                        deleteSelectedAssistVertex();
                    } else {
                        showMessage('请先点击要删除的顶点，然后再按 Delete 键', 'warning');
                    }
                }
                // 删除选中的辅助要素（选择模式下）
                else if (AppState.currentMode === 'assistSelect' && AppState.selectedAssistFeature) {
                    event.preventDefault();
                    deleteSelectedAssistFeature();
                }
            }
        });
    }
    
    // ========== 顶点删除功能 ==========
    function deleteSelectedVertex() {
        if (!AppState.selectedFeature) {
            showMessage('请先选择多边形', 'warning');
            return;
        }
        
        if (AppState.currentMode !== 'editPolygon') {
            showMessage('请先进入编辑模式', 'warning');
            return;
        }
        
        const geometry = AppState.selectedFeature.getGeometry();
        if (!geometry || geometry.getType() !== 'Polygon') {
            showMessage('选中的要素不是多边形', 'error');
            return;
        }
        
        const coordinates = geometry.getCoordinates()[0];
        
        // 检查顶点数量（至少4个点，因为多边形是闭合的，起点=终点）
        if (coordinates.length <= 4) {
            showMessage('多边形至少需要3个顶点', 'warning');
            return;
        }
        
        // 获取鼠标当前位置（使用最后已知的鼠标位置）
        let vertexIndex = AppState.selectedVertexIndex;
        
        // 如果没有预选的顶点，提示用户需要先点击顶点
        if (vertexIndex === null || vertexIndex === undefined || vertexIndex < 0 || vertexIndex >= coordinates.length - 1) {
            showMessage('请先点击要删除的顶点，然后再点击删除按钮', 'warning');
            return;
        }
        
        // 删除指定索引的顶点
        coordinates.splice(vertexIndex, 1);
        
        // 更新最后一个点为第一个点（保持多边形闭合）
        coordinates[coordinates.length - 1] = coordinates[0].slice();
        
        geometry.setCoordinates([coordinates]);
        
        AppState.selectedFeature.changed();
        
        // 重置顶点选择
        AppState.selectedVertexIndex = null;
        AppState.selectedVertexCoordinates = null;
        
        console.log('顶点删除成功，剩余顶点数:', coordinates.length - 1);
        showMessage('顶点删除成功', 'success');
        
        updateStatus();
    }
    
    // 查找并高亮显示最近的顶点
    function findAndHighlightNearestVertex(pixel) {
        if (!AppState.selectedFeature || AppState.currentMode !== 'editPolygon') {
            return -1;
        }
        
        const geometry = AppState.selectedFeature.getGeometry();
        if (!geometry || geometry.getType() !== 'Polygon') return -1;
        
        const coordinates = geometry.getCoordinates()[0];
        const clickCoord = map.getCoordinateFromPixel(pixel);
        
        if (!clickCoord) return -1;
        
        // 找到最近的顶点
        let minDistance = Infinity;
        let closestIndex = -1;
        
        for (let i = 0; i < coordinates.length - 1; i++) {
            const vertex = coordinates[i];
            const distance = Math.sqrt(
                Math.pow(vertex[0] - clickCoord[0], 2) + 
                Math.pow(vertex[1] - clickCoord[1], 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        }
        
        // 设置阈值（像素距离的地图单位转换）- 增大阈值使其更容易选中
        const threshold = map.getView().getResolution() * 30; // 30像素的地图单位
        
        if (minDistance < threshold) {
            AppState.selectedVertexIndex = closestIndex;
            AppState.selectedVertexCoordinates = coordinates[closestIndex];
            console.log('选中顶点索引:', closestIndex, '坐标:', coordinates[closestIndex], '距离:', minDistance);
            
            // 显示视觉反馈
            showMessage(`已选中顶点 ${closestIndex + 1}，点击删除按钮或按 Delete 键删除`, 'info');
            
            return closestIndex;
        }
        
        return -1;
    }
    
    // ========== 绘制功能 ==========
    function startDrawPolygon() {
        // 检查是否有选中的文件
        if (!AppState.selectedJSONFile) {
            showMessage('请先选择一个学区文件', 'warning');
            return;
        }
        
        if (AppState.isDrawing) {
            stopDrawing();
        }
        
        stopEditPolygon();
        
        if (drawInteraction) {
            map.removeInteraction(drawInteraction);
        }
        
        drawInteraction = new ol.interaction.Draw({
            source: vectorSource,
            type: 'Polygon',
            maxPoints: 100, // 设置一个较大的最大点数，防止自动结束
            // 修复：阻止点击上一个节点自动结束绘制，改为只响应双击结束
            condition: function(event) {
                // 允许左键点击添加顶点
                if (event.type === 'pointerdown' && event.originalEvent && event.originalEvent.button === 0) {
                    // 检查是否点击了草图的起点（第一个节点）
                    if (drawInteraction.sketchFeature_) {
                        const geometry = drawInteraction.sketchFeature_.getGeometry();
                        const coordinates = geometry.getCoordinates()[0];
                        if (coordinates && coordinates.length > 1) {
                            const firstCoord = coordinates[0];
                            const clickCoord = event.coordinate;
                            const resolution = map.getView().getResolution();
                            const threshold = resolution * 15; // 15像素的容差
                            const distance = Math.sqrt(
                                Math.pow(firstCoord[0] - clickCoord[0], 2) + 
                                Math.pow(firstCoord[1] - clickCoord[1], 2)
                            );
                            // 如果点击的是第一个节点，阻止结束绘制（返回true继续添加顶点）
                            if (distance < threshold) {
                                console.log('阻止点击第一个节点结束绘制，继续添加顶点');
                                return true; // 继续绘制，不结束
                            }
                        }
                    }
                    return true; // 正常添加顶点
                }
                return true;
            },
            // 只有双击时才结束绘制
            finishCondition: function(event) {
                return false; // 禁止自动结束，使用双击监听手动结束
            }
        });
        
        // 添加双击结束绘制的逻辑
        let dblClickListener = function(event) {
            if (AppState.currentMode === 'drawPolygon' && drawInteraction) {
                // 检查是否至少有3个顶点
                const sketchFeature = drawInteraction.sketchFeature_;
                if (sketchFeature && sketchFeature.getGeometry()) {
                    const geometry = sketchFeature.getGeometry();
                    const coordinates = geometry.getCoordinates()[0];
                    // 多边形是闭合的，所以需要至少4个点（3个顶点+1个闭合点）
                    if (coordinates.length >= 4) {
                        event.preventDefault();
                        event.stopPropagation();
                        drawInteraction.finishDrawing();
                    }
                }
            }
        };
        
        // 在绘制开始时添加双击监听
        drawInteraction.on('drawstart', function() {
            map.on('dblclick', dblClickListener);
        });
        
        // 在绘制结束时移除双击监听
        drawInteraction.on(['drawend', 'drawabort'], function() {
            map.un('dblclick', dblClickListener);
        });
        
        drawInteraction.on('drawend', function(event) {
            const feature = event.feature;
            const featureId = 'polygon_' + Date.now();
            feature.setId(featureId);
            
            // 标记该要素属于哪个文件
            feature.set('sourceFileId', AppState.selectedJSONFile.id);
            feature.set('sourceFileName', AppState.selectedJSONFile.name);
            
            // 添加到对应文件的要素列表
            const features = AppState.jsonFeatureMap.get(AppState.selectedJSONFile.id) || [];
            features.push(feature);
            AppState.jsonFeatureMap.set(AppState.selectedJSONFile.id, features);
            AppState.selectedJSONFile.featureCount = features.length;
            
            console.log(`多边形绘制完成，ID: ${featureId}, 所属文件: ${AppState.selectedJSONFile.name}`);
            
            // 提示用户输入多边形名称
            setTimeout(() => {
                promptPolygonName(feature);
            }, 100);
            
            // 更新文件列表显示
            updateJSONFileList();
        });
        
        map.addInteraction(drawInteraction);
        AppState.currentMode = 'drawPolygon';
        AppState.isDrawing = true;
        
        updateToolbarButtons();
        updateStatus();
        
        showMessage('开始绘制多边形，双击完成', 'info');
    }
    
    function stopDrawPolygon() {
        if (drawInteraction && AppState.currentMode === 'drawPolygon') {
            map.removeInteraction(drawInteraction);
            drawInteraction = null;
        }
        
        AppState.currentMode = 'browse';
        AppState.isDrawing = false;
        
        updateToolbarButtons();
        updateStatus();
    }
    
    function startDrawLine() {
        if (AppState.isDrawing) {
            stopDrawing();
        }
        
        stopEditPolygon();
        
        if (drawInteraction) {
            map.removeInteraction(drawInteraction);
        }
        
        drawInteraction = new ol.interaction.Draw({
            source: lineSource,
            type: 'LineString',
            maxPoints: 100 // 设置一个较大的最大点数，防止自动结束
        });
        
        // 添加双击结束绘制的逻辑
        let dblClickListener = function(event) {
            if (AppState.currentMode === 'drawLine' && drawInteraction) {
                // 检查是否至少有2个顶点
                const sketchFeature = drawInteraction.sketchFeature_;
                if (sketchFeature && sketchFeature.getGeometry()) {
                    const geometry = sketchFeature.getGeometry();
                    const coordinates = geometry.getCoordinates();
                    if (coordinates.length >= 2) {
                        event.preventDefault();
                        event.stopPropagation();
                        drawInteraction.finishDrawing();
                    }
                }
            }
        };
        
        // 在绘制开始时添加双击监听
        drawInteraction.on('drawstart', function() {
            map.on('dblclick', dblClickListener);
        });
        
        // 在绘制结束时移除双击监听
        drawInteraction.on(['drawend', 'drawabort'], function() {
            map.un('dblclick', dblClickListener);
        });
        
        // 绘制完成时添加到默认辅助元素图层
        drawInteraction.on('drawend', function(event) {
            const feature = event.feature;
            const featureId = 'assist_line_' + Date.now();
            feature.setId(featureId);
            
            // 如果没有选中的辅助元素文件，使用默认图层
            if (!AppState.selectedAssistFile) {
                createDefaultAssistLayer();
            }
            
            feature.set('assistFileId', AppState.selectedAssistFile.id);
            feature.set('sourceFileName', AppState.selectedAssistFile.name);
            
            // 添加到对应文件的要素列表
            const features = AppState.assistFeatureMap.get(AppState.selectedAssistFile.id) || [];
            features.push(feature);
            AppState.assistFeatureMap.set(AppState.selectedAssistFile.id, features);
            AppState.selectedAssistFile.featureCount = features.length;
            
            updateAssistFileList();
            console.log(`辅助线绘制完成，添加到图层: ${AppState.selectedAssistFile.name}`);
        });
        
        map.addInteraction(drawInteraction);
        AppState.currentMode = 'drawLine';
        AppState.isDrawing = true;
        
        updateToolbarButtons();
        updateStatus();
        
        showMessage('开始绘制辅助线，双击完成', 'info');
    }
    
    function stopDrawLine() {
        if (drawInteraction && AppState.currentMode === 'drawLine') {
            map.removeInteraction(drawInteraction);
            drawInteraction = null;
        }
        
        AppState.currentMode = 'browse';
        AppState.isDrawing = false;
        
        updateToolbarButtons();
        updateStatus();
    }
    
    // 创建默认辅助元素图层（唯一默认图层）
    function createDefaultAssistLayer() {
        // 检查是否已存在默认辅助图层
        const existingDefaultLayer = AppState.assistFiles.find(f => f.isDefault);
        if (existingDefaultLayer) {
            console.log('默认辅助元素图层已存在');
            return existingDefaultLayer;
        }
        
        const fileId = 'assist_layer_default';
        const assistFile = {
            id: fileId,
            name: '辅助元素图层',
            importTime: new Date().toLocaleString(),
            featureCount: 0,
            isDefault: true // 标记为默认图层
        };
        
        AppState.assistFiles.push(assistFile);
        AppState.assistFeatureMap.set(fileId, []);
        AppState.selectedAssistFile = assistFile;
        
        updateAssistFileList();
        updateToggleAllAssistButton();
        
        console.log(`创建默认辅助元素图层: ${assistFile.name}, ID: ${fileId}`);
        return assistFile;
    }
    
    // ========== 辅助多边形绘制 ==========
    function startDrawAssistPolygon() {
        if (AppState.isDrawing) {
            stopDrawing();
        }
        
        stopEditPolygon();
        stopAssistPolygonEdit(); // 停止辅助多边形编辑模式
        
        if (drawInteraction) {
            map.removeInteraction(drawInteraction);
        }
        
        drawInteraction = new ol.interaction.Draw({
            source: assistPolygonSource,
            type: 'Polygon',
            maxPoints: 100, // 设置一个较大的最大点数，防止自动结束
            // 修复：阻止点击上一个节点自动结束绘制，改为只响应双击结束
            condition: function(event) {
                // 允许左键点击添加顶点
                if (event.type === 'pointerdown' && event.originalEvent && event.originalEvent.button === 0) {
                    // 检查是否点击了草图的起点（第一个节点）
                    if (drawInteraction.sketchFeature_) {
                        const geometry = drawInteraction.sketchFeature_.getGeometry();
                        const coordinates = geometry.getCoordinates()[0];
                        if (coordinates && coordinates.length > 1) {
                            const firstCoord = coordinates[0];
                            const clickCoord = event.coordinate;
                            const resolution = map.getView().getResolution();
                            const threshold = resolution * 15; // 15像素的容差
                            const distance = Math.sqrt(
                                Math.pow(firstCoord[0] - clickCoord[0], 2) + 
                                Math.pow(firstCoord[1] - clickCoord[1], 2)
                            );
                            // 如果点击的是第一个节点，阻止结束绘制（返回true继续添加顶点）
                            if (distance < threshold) {
                                console.log('阻止点击第一个节点结束绘制，继续添加顶点');
                                return true; // 继续绘制，不结束
                            }
                        }
                    }
                    return true; // 正常添加顶点
                }
                return true;
            },
            // 只有双击时才结束绘制
            finishCondition: function(event) {
                return false; // 禁止自动结束，使用双击监听手动结束
            }
        });
        
        // 添加双击结束绘制的逻辑
        let dblClickListener = function(event) {
            if (AppState.currentMode === 'drawAssistPolygon' && drawInteraction) {
                // 检查是否至少有3个顶点
                const sketchFeature = drawInteraction.sketchFeature_;
                if (sketchFeature && sketchFeature.getGeometry()) {
                    const geometry = sketchFeature.getGeometry();
                    const coordinates = geometry.getCoordinates()[0];
                    // 多边形是闭合的，所以需要至少4个点（3个顶点+1个闭合点）
                    if (coordinates.length >= 4) {
                        event.preventDefault();
                        event.stopPropagation();
                        drawInteraction.finishDrawing();
                    }
                }
            }
        };
        
        // 在绘制开始时添加双击监听
        drawInteraction.on('drawstart', function() {
            map.on('dblclick', dblClickListener);
        });
        
        // 在绘制结束时移除双击监听
        drawInteraction.on(['drawend', 'drawabort'], function() {
            map.un('dblclick', dblClickListener);
        });
        
        drawInteraction.on('drawend', function(event) {
            console.log('辅助多边形绘制完成');
            const feature = event.feature;
            const featureId = 'assist_polygon_' + Date.now();
            feature.setId(featureId);
            
            // 如果没有选中的辅助元素文件，使用默认图层
            if (!AppState.selectedAssistFile) {
                createDefaultAssistLayer();
            }
            
            feature.set('assistFileId', AppState.selectedAssistFile.id);
            feature.set('sourceFileName', AppState.selectedAssistFile.name);
            
            // 添加到对应文件的要素列表
            const features = AppState.assistFeatureMap.get(AppState.selectedAssistFile.id) || [];
            features.push(feature);
            AppState.assistFeatureMap.set(AppState.selectedAssistFile.id, features);
            AppState.selectedAssistFile.featureCount = features.length;
            
            updateAssistFileList();
            
            // 提示用户输入辅助多边形名称
            setTimeout(() => {
                promptForAssistPolygonName(feature);
            }, 100);
        });
        
        map.addInteraction(drawInteraction);
        AppState.currentMode = 'drawAssistPolygon';
        AppState.isDrawing = true;
        
        updateToolbarButtons();
        updateStatus();
        
        showMessage('开始绘制辅助多边形，双击完成', 'info');
    }
    
    function stopDrawAssistPolygon() {
        if (drawInteraction && AppState.currentMode === 'drawAssistPolygon') {
            map.removeInteraction(drawInteraction);
            drawInteraction = null;
        }
        
        AppState.currentMode = 'browse';
        AppState.isDrawing = false;
        
        updateToolbarButtons();
        updateStatus();
    }
    
    // 辅助多边形命名对话框
    function promptForAssistPolygonName(feature) {
        if ($('#assistPolygonNameModal').length > 0) {
            $('#assistPolygonNameModal').remove();
        }
        
        const modalHtml = `
            <div id="assistPolygonNameModal" class="modal-overlay">
                <div class="modal-content">
                    <h3><i class="fas fa-tag"></i> 为辅助多边形命名</h3>
                    <p style="color:#666;margin-bottom:15px;">请输入这个辅助多边形的名称（将显示在多边形中心）</p>
                    <input type="text" id="assistPolygonNameInput" placeholder="输入辅助多边形名称" autofocus>
                    <div class="modal-buttons">
                        <button id="confirmAssistPolygonName" class="modal-confirm">
                            <i class="fas fa-check"></i> 确认
                        </button>
                        <button id="cancelAssistPolygonName" class="modal-cancel">
                            <i class="fas fa-times"></i> 取消
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(modalHtml);
        
        setTimeout(() => {
            $('#assistPolygonNameInput').focus();
        }, 100);
        
        $('#confirmAssistPolygonName').off('click').on('click', function() {
            const name = $('#assistPolygonNameInput').val().trim();
            if (name) {
                $('#assistPolygonNameModal').remove();
                setAssistPolygonName(feature, name);
                showMessage(`辅助多边形已命名为: ${name}`, 'success');
            } else {
                alert('请输入辅助多边形名称');
                $('#assistPolygonNameInput').focus();
            }
        });
        
        $('#cancelAssistPolygonName').off('click').on('click', function() {
            $('#assistPolygonNameModal').remove();
            // 不设置名称，使用默认空名称
        });
        
        $('#assistPolygonNameInput').off('keypress').on('keypress', function(e) {
            if (e.which === 13) {
                $('#confirmAssistPolygonName').click();
            }
        });
        
        $('#assistPolygonNameModal').off('click').on('click', function(e) {
            if (e.target.id === 'assistPolygonNameModal') {
                $('#cancelAssistPolygonName').click();
            }
        });
    }
    
    // 设置辅助多边形名称
    function setAssistPolygonName(feature, name) {
        feature.set('name', name);
        feature.changed();
    }
    
    // ========== 辅助文字绘制 ==========
    function startDrawAssistText() {
        if (AppState.isDrawing) {
            stopDrawing();
        }
        
        stopEditPolygon();
        
        showMessage('请点击地图放置文字标注', 'info');
        
        // 创建临时点击交互来放置文字
        const clickHandler = function(event) {
            const coordinate = event.coordinate;
            
            // 如果没有选中的辅助元素文件，使用默认图层
            if (!AppState.selectedAssistFile) {
                createDefaultAssistLayer();
            }
            
            // 弹出输入框让用户输入文字
            promptForAssistText(coordinate, function(feature) {
                // 回调函数：文字添加完成后
                if (feature) {
                    feature.set('assistFileId', AppState.selectedAssistFile.id);
                    feature.set('sourceFileName', AppState.selectedAssistFile.name);
                    
                    const features = AppState.assistFeatureMap.get(AppState.selectedAssistFile.id) || [];
                    features.push(feature);
                    AppState.assistFeatureMap.set(AppState.selectedAssistFile.id, features);
                    AppState.selectedAssistFile.featureCount = features.length;
                    
                    updateAssistFileList();
                }
            });
            
            // 移除临时交互
            map.un('click', clickHandler);
            AppState.mapClickHandler = null;
            AppState.currentMode = 'browse';
            AppState.isDrawing = false;
            updateToolbarButtons();
            updateStatus();
        };
        
        // 移除之前的点击处理器
        if (AppState.mapClickHandler) {
            map.un('click', AppState.mapClickHandler);
        }
        
        map.on('click', clickHandler);
        AppState.mapClickHandler = clickHandler;
        
        AppState.currentMode = 'drawAssistText';
        AppState.isDrawing = true;
        updateToolbarButtons();
        updateStatus();
    }
    
    // ========== 辅助点绘制 ==========
    function startDrawAssistPoint() {
        if (AppState.isDrawing) {
            stopDrawing();
        }
        
        stopEditPolygon();
        
        showMessage('请点击地图放置图标点，然后选择图标类型', 'info');
        
        // 创建临时点击交互来放置点
        const clickHandler = function(event) {
            const coordinate = event.coordinate;
            
            // 如果没有选中的辅助元素文件，使用默认图层
            if (!AppState.selectedAssistFile) {
                createDefaultAssistLayer();
            }
            
            // 弹出选择框让用户选择图标
            promptForAssistPointIcon(coordinate, function(feature) {
                // 回调函数：点添加完成后
                if (feature) {
                    feature.set('assistFileId', AppState.selectedAssistFile.id);
                    feature.set('sourceFileName', AppState.selectedAssistFile.name);
                    
                    const features = AppState.assistFeatureMap.get(AppState.selectedAssistFile.id) || [];
                    features.push(feature);
                    AppState.assistFeatureMap.set(AppState.selectedAssistFile.id, features);
                    AppState.selectedAssistFile.featureCount = features.length;
                    
                    updateAssistFileList();
                }
            });
            
            // 移除临时交互
            map.un('click', clickHandler);
            AppState.mapClickHandler = null;
            AppState.currentMode = 'browse';
            AppState.isDrawing = false;
            updateToolbarButtons();
            updateStatus();
        };
        
        // 移除之前的点击处理器
        if (AppState.mapClickHandler) {
            map.un('click', AppState.mapClickHandler);
        }
        
        map.on('click', clickHandler);
        AppState.mapClickHandler = clickHandler;
        
        AppState.currentMode = 'drawAssistPoint';
        AppState.isDrawing = true;
        updateToolbarButtons();
        updateStatus();
    }
    
    function stopDrawAssistPoint() {
        AppState.currentMode = 'browse';
        AppState.isDrawing = false;
        updateToolbarButtons();
        updateStatus();
    }
    
    function promptForAssistPointIcon(coordinate, callback) {
        if ($('#assistPointModal').length > 0) {
            $('#assistPointModal').remove();
        }
        
        const modalHtml = `
            <div id="assistPointModal" class="modal-overlay">
                <div class="modal-content" style="max-width: 400px;">
                    <h3><i class="fas fa-map-marker-alt"></i> 添加辅助点</h3>
                    <p style="color:#666;margin-bottom:15px;">请选择图标类型，并可选择添加文字标注</p>
                    <div class="icon-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;">
                        <div class="icon-option selected" data-icon="default" title="位置标记">📍</div>
                        <div class="icon-option" data-icon="home" title="住宅">🏠</div>
                        <div class="icon-option" data-icon="school" title="学校">🏫</div>
                        <div class="icon-option" data-icon="hospital" title="医院">🏥</div>
                        <div class="icon-option" data-icon="shop" title="商店">🏪</div>
                        <div class="icon-option" data-icon="restaurant" title="餐厅">🍽️</div>
                        <div class="icon-option" data-icon="park" title="公园">🌳</div>
                        <div class="icon-option" data-icon="bus" title="公交">🚌</div>
                        <div class="icon-option" data-icon="car" title="停车场">🚗</div>
                        <div class="icon-option" data-icon="flag" title="旗帜">🚩</div>
                        <div class="icon-option" data-icon="star" title="收藏">⭐</div>
                        <div class="icon-option" data-icon="warning" title="警告">⚠️</div>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #666;">图标颜色</label>
                        <input type="color" id="assistPointColor" value="#e74c3c" style="width: 100%; height: 40px; border: none; border-radius: 4px; cursor: pointer;">
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; color: #666;">图标大小</label>
                        <input type="range" id="assistPointSize" min="0.5" max="2" step="0.1" value="1" style="width: 100%;">
                        <span id="sizeValue" style="font-size: 12px; color: #999;">1.0x</span>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; color: #666;">
                            文字标注 <span style="color: #999; font-size: 12px;">（可选）</span>
                        </label>
                        <input type="text" id="assistPointText" placeholder="输入文字标注（如：起点、终点等）" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    </div>
                    <div style="margin-bottom: 20px; display: none;" id="textStyleSection">
                        <label style="display: block; margin-bottom: 5px; color: #666;">文字颜色</label>
                        <input type="color" id="assistPointTextColor" value="#333333" style="width: 100%; height: 40px; border: none; border-radius: 4px; cursor: pointer;">
                    </div>
                    <div class="modal-buttons">
                        <button id="confirmAssistPoint" class="modal-confirm">
                            <i class="fas fa-check"></i> 确认
                        </button>
                        <button id="cancelAssistPoint" class="modal-cancel">
                            <i class="fas fa-times"></i> 取消
                        </button>
                    </div>
                </div>
            </div>
            <style>
                .icon-option {
                    font-size: 24px;
                    padding: 10px;
                    text-align: center;
                    cursor: pointer;
                    border: 2px solid #ddd;
                    border-radius: 8px;
                    transition: all 0.2s;
                }
                .icon-option:hover {
                    background: #f0f0f0;
                    border-color: #3498db;
                }
                .icon-option.selected {
                    background: #3498db;
                    border-color: #2980b9;
                    transform: scale(1.1);
                }
            </style>
        `;
        
        $('body').append(modalHtml);
        
        // 图标选择事件
        let selectedIcon = 'default';
        $('.icon-option').on('click', function() {
            $('.icon-option').removeClass('selected');
            $(this).addClass('selected');
            selectedIcon = $(this).data('icon');
        });
        
        // 大小滑块事件
        $('#assistPointSize').on('input', function() {
            $('#sizeValue').text($(this).val() + 'x');
        });
        
        // 文字输入时显示文字样式选项
        $('#assistPointText').on('input', function() {
            if ($(this).val().trim()) {
                $('#textStyleSection').show();
            } else {
                $('#textStyleSection').hide();
            }
        });
        
        $('#confirmAssistPoint').off('click').on('click', function() {
            const color = $('#assistPointColor').val();
            const size = parseFloat($('#assistPointSize').val());
            const text = $('#assistPointText').val().trim();
            const textColor = $('#assistPointTextColor').val();
            $('#assistPointModal').remove();
            const feature = addAssistPointFeature(coordinate, selectedIcon, color, size, text, textColor);
            const msg = text ? `已添加辅助点: ${selectedIcon} (${text})` : `已添加辅助点: ${selectedIcon}`;
            showMessage(msg, 'success');
            if (callback) callback(feature);
        });
        
        $('#cancelAssistPoint').off('click').on('click', function() {
            $('#assistPointModal').remove();
            if (callback) callback(null);
        });
        
        $('#assistPointModal').off('click').on('click', function(e) {
            if (e.target.id === 'assistPointModal') {
                $('#cancelAssistPoint').click();
            }
        });
    }
    
    function addAssistPointFeature(coordinate, iconType, iconColor, iconSize, text, textColor) {
        const feature = new ol.Feature({
            geometry: new ol.geom.Point(coordinate),
            iconType: iconType,
            iconColor: iconColor,
            iconSize: iconSize
        });
        
        // 如果有文字标注，添加到要素属性
        if (text) {
            feature.set('text', text);
            feature.set('textColor', textColor || '#333333');
        }
        
        feature.setId('assist_point_' + Date.now());
        assistPointSource.addFeature(feature);
        updateStatus();
        return feature;
    }
    
    function promptForAssistText(coordinate, callback) {
        if ($('#assistTextModal').length > 0) {
            $('#assistTextModal').remove();
        }
        
        const modalHtml = `
            <div id="assistTextModal" class="modal-overlay">
                <div class="modal-content">
                    <h3><i class="fas fa-font"></i> 添加辅助文字</h3>
                    <p style="color:#666;margin-bottom:15px;">请输入要显示的文字内容</p>
                    <input type="text" id="assistTextInput" placeholder="输入文字内容" autofocus>
                    <div class="modal-buttons">
                        <button id="confirmAssistText" class="modal-confirm">
                            <i class="fas fa-check"></i> 确认
                        </button>
                        <button id="cancelAssistText" class="modal-cancel">
                            <i class="fas fa-times"></i> 取消
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(modalHtml);
        
        setTimeout(() => {
            $('#assistTextInput').focus();
        }, 100);
        
        $('#confirmAssistText').off('click').on('click', function() {
            const text = $('#assistTextInput').val().trim();
            if (text) {
                $('#assistTextModal').remove();
                const feature = addAssistTextFeature(coordinate, text);
                showMessage(`已添加文字标注: ${text}`, 'success');
                if (callback) callback(feature);
            } else {
                alert('请输入文字内容');
                $('#assistTextInput').focus();
            }
        });
        
        $('#cancelAssistText').off('click').on('click', function() {
            $('#assistTextModal').remove();
            if (callback) callback(null);
        });
        
        $('#assistTextInput').off('keypress').on('keypress', function(e) {
            if (e.which === 13) {
                $('#confirmAssistText').click();
            }
        });
        
        $('#assistTextModal').off('click').on('click', function(e) {
            if (e.target.id === 'assistTextModal') {
                $('#cancelAssistText').click();
            }
        });
    }
    
    function addAssistTextFeature(coordinate, text) {
        const feature = new ol.Feature({
            geometry: new ol.geom.Point(coordinate),
            text: text
        });
        feature.setId('assist_text_' + Date.now());
        assistTextSource.addFeature(feature);
        updateStatus();
        return feature;
    }
    
    // ========== 清除所有辅助要素 ==========
    function clearAssistFeatures() {
        const lineCount = lineSource.getFeatures().length;
        const polygonCount = assistPolygonSource.getFeatures().length;
        const textCount = assistTextSource.getFeatures().length;
        const pointCount = assistPointSource.getFeatures().length;
        const totalCount = lineCount + polygonCount + textCount + pointCount;
        
        if (totalCount === 0) {
            showMessage('没有辅助要素可清除', 'warning');
            return;
        }
        
        let detailMsg = [];
        if (lineCount > 0) detailMsg.push(`${lineCount} 条辅助线`);
        if (polygonCount > 0) detailMsg.push(`${polygonCount} 个辅助多边形`);
        if (textCount > 0) detailMsg.push(`${textCount} 个文字标注`);
        if (pointCount > 0) detailMsg.push(`${pointCount} 个辅助点`);
        
        if (confirm(`确定要清除所有辅助要素吗？\n包含：${detailMsg.join('、')}`)) {
            lineSource.clear();
            assistPolygonSource.clear();
            assistTextSource.clear();
            assistPointSource.clear();
            
            // 清除默认图层的要素映射，但保留默认图层本身
            const defaultLayer = AppState.assistFiles.find(f => f.isDefault);
            if (defaultLayer) {
                AppState.assistFeatureMap.set(defaultLayer.id, []);
                defaultLayer.featureCount = 0;
                AppState.selectedAssistFile = defaultLayer;
            }
            
            // 只清除非默认的辅助元素文件（导入的文件）
            const importedFiles = AppState.assistFiles.filter(f => !f.isDefault);
            importedFiles.forEach(file => {
                AppState.assistFeatureMap.delete(file.id);
                AppState.hiddenAssistFiles.delete(file.id);
            });
            AppState.assistFiles = AppState.assistFiles.filter(f => f.isDefault);
            
            if (assistSelectInteraction) {
                assistSelectInteraction.getFeatures().clear();
            }
            
            updateAssistFileList();
            updateToggleAllAssistButton();
            updateStatus();
            showMessage('所有辅助要素已清除，默认图层保留', 'success');
        }
    }
    
    // ========== 辅助要素显示/隐藏切换 ==========
    function toggleAssistFeaturesVisibility() {
        AppState.assistFeaturesVisible = !AppState.assistFeaturesVisible;
        
        const isVisible = AppState.assistFeaturesVisible;
        
        // 设置所有辅助要素图层的可见性
        if (window.mapLayers) {
            window.mapLayers.lineLayer.setVisible(isVisible);
            window.mapLayers.assistPolygonLayer.setVisible(isVisible);
            window.mapLayers.assistTextLayer.setVisible(isVisible);
            window.mapLayers.assistPointLayer.setVisible(isVisible);
        }
        
        // 更新按钮状态
        updateAssistVisibilityButton();
        
        // 显示提示
        const msg = isVisible ? '辅助要素已显示' : '辅助要素已隐藏';
        const type = isVisible ? 'success' : 'info';
        showMessage(msg, type);
        
        console.log(`辅助要素可见性: ${isVisible ? '显示' : '隐藏'}`);
    }
    
    function updateAssistVisibilityButton() {
        const $btn = $('#toggleAssistVisibility');
        if (AppState.assistFeaturesVisible) {
            $btn.html('<i class="fas fa-eye"></i>');
            $btn.attr('title', '隐藏辅助要素');
            $btn.removeClass('hidden-state');
        } else {
            $btn.html('<i class="fas fa-eye-slash"></i>');
            $btn.attr('title', '显示辅助要素');
            $btn.addClass('hidden-state');
        }
    }
    
    // ========== 辅助要素选择模式 ==========
    function toggleAssistSelectMode() {
        if (AppState.currentMode === 'assistSelect') {
            stopAssistSelectMode();
        } else {
            startAssistSelectMode();
        }
    }
    
    function startAssistSelectMode() {
        // 停止其他模式
        stopDrawing();
        stopEditPolygon();
        
        // 激活辅助要素选择
        if (assistSelectInteraction) {
            assistSelectInteraction.setActive(true);
        }
        
        AppState.currentMode = 'assistSelect';
        updateToolbarButtons();
        updateStatus();
        
        showMessage('辅助要素选择模式：点击选中要删除的要素', 'info');
    }
    
    function stopAssistSelectMode() {
        // 如果正在编辑辅助多边形，先停止编辑
        if (AppState.currentMode === 'editAssistPolygon') {
            stopAssistPolygonEdit();
        }
        
        if (assistSelectInteraction) {
            assistSelectInteraction.setActive(false);
            assistSelectInteraction.getFeatures().clear();
        }
        AppState.selectedAssistFeature = null;
        
        // 清除顶点高亮和选择
        clearVertexHighlight();
        AppState.selectedAssistVertexIndex = null;
        AppState.selectedAssistVertexCoordinates = null;
        
        AppState.currentMode = 'browse';
        updateToolbarButtons();
        updateStatus();
    }
    
    // ========== 删除选中的辅助要素 ==========
    function deleteSelectedAssistFeature() {
        if (!AppState.selectedAssistFeature) {
            showMessage('请先选择要删除的辅助要素', 'warning');
            return;
        }
        
        const feature = AppState.selectedAssistFeature;
        const geometryType = feature.getGeometry().getType();
        let typeName = '辅助要素';
        
        // 根据类型从对应数据源删除
        if (geometryType === 'LineString') {
            typeName = '辅助线';
            lineSource.removeFeature(feature);
        } else if (geometryType === 'Polygon') {
            typeName = '辅助多边形';
            assistPolygonSource.removeFeature(feature);
        } else if (geometryType === 'Point') {
            // 判断类型：纯文字 / 图标点 / 图标+文字
            const hasIcon = feature.get('iconType');
            const hasText = feature.get('text');
            
            if (hasIcon && hasText) {
                typeName = '辅助点(带文字)';
                assistPointSource.removeFeature(feature);
            } else if (hasIcon) {
                typeName = '辅助点';
                assistPointSource.removeFeature(feature);
            } else {
                typeName = '辅助文字';
                assistTextSource.removeFeature(feature);
            }
        }
        
        // ========== BUG修复：同时从 assistFeatureMap 中移除 ==========
        const assistFileId = feature.get('assistFileId');
        if (assistFileId) {
            const fileFeatures = AppState.assistFeatureMap.get(assistFileId);
            if (fileFeatures) {
                const index = fileFeatures.indexOf(feature);
                if (index > -1) {
                    fileFeatures.splice(index, 1);
                    console.log(`已从 assistFeatureMap 中移除要素，文件ID: ${assistFileId}, 剩余要素: ${fileFeatures.length}`);
                }
            }
            
            // 更新文件计数
            const assistFile = AppState.assistFiles.find(f => f.id === assistFileId);
            if (assistFile) {
                assistFile.featureCount = Math.max(0, (assistFile.featureCount || 0) - 1);
            }
        }
        
        // 清除选择
        if (assistSelectInteraction) {
            assistSelectInteraction.getFeatures().clear();
        }
        AppState.selectedAssistFeature = null;
        
        // 清除顶点高亮和选择（如果删除的是正在编辑的多边形）
        clearVertexHighlight();
        AppState.selectedAssistVertexIndex = null;
        AppState.selectedAssistVertexCoordinates = null;
        
        // 更新文件列表显示
        updateAssistFileList();
        
        updateStatus();
        showMessage(`${typeName}已删除`, 'success');
    }
    
    // ========== 导入辅助要素 ==========
    function handleAssistGeoJSONImport(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }
        
        importSingleAssistFile(file);
        
        // 重置文件输入
        event.target.value = '';
    }
    
    // 导入单个辅助元素文件（内部函数）
    function importSingleAssistFile(file) {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const geoJSONData = JSON.parse(e.target.result);
                
                console.log('导入辅助要素文件:', file.name);
                
                // 验证GeoJSON格式
                if (!geoJSONData.type || geoJSONData.type !== 'FeatureCollection') {
                    throw new Error('无效的GeoJSON格式：必须是FeatureCollection类型');
                }
                
                if (!Array.isArray(geoJSONData.features)) {
                    throw new Error('无效的GeoJSON格式：缺少features数组');
                }
                
                // 创建新的辅助元素文件记录
                const fileId = 'assist_file_' + Date.now() + '_' + AppState.nextAssistFileId++;
                const assistFile = {
                    id: fileId,
                    name: file.name,
                    importTime: new Date().toLocaleString(),
                    featureCount: 0
                };
                
                const format = new ol.format.GeoJSON();
                const importedFeatures = [];
                let lineCount = 0;
                let polygonCount = 0;
                let textCount = 0;
                let pointCount = 0;
                
                // 解析GeoJSON要素
                geoJSONData.features.forEach(function(featureData, index) {
                    try {
                        const geoJsonGeomType = featureData.geometry && featureData.geometry.type;
                        const propsType = featureData.properties && featureData.properties.type;
                        
                        // 调试：导入前的坐标
                        const coordsBefore = featureData.geometry.coordinates;
                        console.log(`导入前坐标[${index}]:`, Array.isArray(coordsBefore) && coordsBefore[0] ? 
                            (Array.isArray(coordsBefore[0]) ? coordsBefore[0][0] : coordsBefore[0]) : coordsBefore);
                        
                        const feature = format.readFeature(featureData, {
                            featureProjection: 'EPSG:3857',
                            dataProjection: 'EPSG:4326'
                        });
                        
                        // 调试：导入后的坐标
                        const geomAfter = feature.getGeometry();
                        const coordsAfter = geomAfter.getType() === 'Polygon' ? 
                            geomAfter.getCoordinates()[0][0] : geomAfter.getCoordinates();
                        console.log(`导入后坐标[${index}]:`, coordsAfter);
                        
                        const importTimestamp = Date.now();
                        let featureId = feature.getId();
                        if (!featureId) {
                            featureId = 'assist_imported_' + importTimestamp + '_' + index;
                        } else {
                            featureId = featureId + '_reimported_' + importTimestamp;
                        }
                        feature.setId(featureId);
                        
                        feature.set('isAssistFeature', true);
                        feature.set('sourceFileName', file.name);
                        feature.set('assistFileId', fileId); // 关联到辅助元素文件
                        
                        const olGeometryType = feature.getGeometry().getType();
                        let isHandled = false;
                        
                        if (propsType === 'assistLine' || olGeometryType === 'LineString' || olGeometryType === 'MultiLineString') {
                            restoreFeatureStyle(feature, featureData);
                            lineSource.addFeature(feature);
                            lineCount++;
                            isHandled = true;
                        }
                        else if (propsType === 'assistPoint' || (featureData.properties && featureData.properties.iconType)) {
                            if (featureData.properties) {
                                if (featureData.properties.iconType) feature.set('iconType', featureData.properties.iconType);
                                if (featureData.properties.iconColor) feature.set('iconColor', featureData.properties.iconColor);
                                if (featureData.properties.iconSize) feature.set('iconSize', featureData.properties.iconSize);
                                if (featureData.properties.text) feature.set('text', featureData.properties.text);
                                if (featureData.properties.textColor) feature.set('textColor', featureData.properties.textColor);
                            }
                            assistPointSource.addFeature(feature);
                            pointCount++;
                            isHandled = true;
                        }
                        else if (propsType === 'assistText' || (olGeometryType === 'Point' && featureData.properties && featureData.properties.text && !featureData.properties.iconType)) {
                            if (featureData.properties && featureData.properties.text) {
                                feature.set('text', featureData.properties.text);
                            }
                            restoreFeatureStyle(feature, featureData);
                            assistTextSource.addFeature(feature);
                            textCount++;
                            isHandled = true;
                        }
                        else if (propsType === 'assistPolygon' || olGeometryType === 'Polygon' || olGeometryType === 'MultiPolygon') {
                            if (featureData.properties && featureData.properties.name) {
                                feature.set('name', featureData.properties.name);
                            }
                            restoreFeatureStyle(feature, featureData);
                            assistPolygonSource.addFeature(feature);
                            polygonCount++;
                            isHandled = true;
                        }
                        
                        if (isHandled) {
                            importedFeatures.push(feature);
                        }
                        
                    } catch (featureError) {
                        console.warn(`跳过无效辅助要素:`, featureError.message);
                    }
                });
                
                const totalCount = lineCount + polygonCount + textCount + pointCount;
                
                if (totalCount > 0) {
                    // 更新文件记录
                    assistFile.featureCount = totalCount;
                    AppState.assistFiles.push(assistFile);
                    AppState.assistFeatureMap.set(fileId, importedFeatures);
                    
                    // 更新列表并选中新文件
                    updateAssistFileList();
                    selectAssistFile(fileId);
                    updateToggleAllAssistButton();
                    
                    // 缩放到导入的数据范围
                    const extent = ol.extent.createEmpty();
                    importedFeatures.forEach(feature => {
                        const geometry = feature.getGeometry();
                        if (geometry) {
                            ol.extent.extend(extent, geometry.getExtent());
                        }
                    });
                    
                    // 调试：输出 extent
                    console.log(`导入后 extent: [${extent.join(', ')}]`);
                    
                    if (extent && extent[0] !== Infinity) {
                        // 检查 extent 是否合理（Web墨卡托坐标通常在数百万范围内）
                        const isValidExtent = extent[0] > -20037508 && extent[0] < 20037508 && 
                                            extent[1] > -20037508 && extent[1] < 20037508;
                        if (!isValidExtent) {
                            console.error('警告：extent 坐标值异常，可能是坐标系转换问题！');
                        }
                        
                        map.getView().fit(extent, {
                            padding: [50, 50, 50, 50],
                            maxZoom: 15,
                            duration: 1000
                        });
                    }
                    
                    const detailMsg = [];
                    if (lineCount > 0) detailMsg.push(`${lineCount} 条辅助线`);
                    if (polygonCount > 0) detailMsg.push(`${polygonCount} 个辅助多边形`);
                    if (textCount > 0) detailMsg.push(`${textCount} 个文字标注`);
                    if (pointCount > 0) detailMsg.push(`${pointCount} 个辅助点`);
                    
                    showMessage(`成功导入 "${file.name}"（${detailMsg.join('、')}）`, 'success');
                    console.log(`辅助元素文件导入完成: ${file.name}, 共${totalCount}个要素`);
                } else {
                    showMessage('文件中没有可识别的辅助要素', 'warning');
                }
                
            } catch (error) {
                console.error('导入辅助要素失败:', error);
                showMessage('导入失败：' + error.message, 'error');
            }
        };
        
        reader.onerror = function() {
            showMessage('读取文件失败，请重试', 'error');
        };
        
        reader.readAsText(file);
    }
    
    // 处理辅助元素文件夹导入
    function handleAssistGeoJSONFolderImport(event) {
        const files = Array.from(event.target.files);
        
        const geojsonFiles = files.filter(file => 
            file.name.toLowerCase().endsWith('.geojson') || 
            file.name.toLowerCase().endsWith('.json')
        );
        
        if (geojsonFiles.length === 0) {
            showMessage('文件夹中没有找到GeoJSON文件', 'warning');
            return;
        }
        
        console.log(`准备导入文件夹中的 ${geojsonFiles.length} 个辅助元素文件`);
        showMessage(`开始导入 ${geojsonFiles.length} 个辅助元素文件...`, 'info');
        
        let importedCount = 0;
        let failedCount = 0;
        let processedCount = 0;
        
        geojsonFiles.forEach((file, index) => {
            setTimeout(() => {
                const reader = new FileReader();
                
                reader.onload = function(e) {
                    try {
                        const geoJSONData = JSON.parse(e.target.result);
                        
                        if (!geoJSONData.type || geoJSONData.type !== 'FeatureCollection') {
                            throw new Error('无效的GeoJSON格式');
                        }
                        
                        // 创建文件记录并导入
                        const fileId = 'assist_file_' + Date.now() + '_' + index;
                        const assistFile = {
                            id: fileId,
                            name: file.name,
                            importTime: new Date().toLocaleString(),
                            featureCount: 0
                        };
                        
                        const format = new ol.format.GeoJSON();
                        const importedFeatures = [];
                        
                        geoJSONData.features.forEach(function(featureData, idx) {
                            try {
                                // 调试：导入前的坐标
                                const coordsBefore = featureData.geometry.coordinates;
                                console.log(`[文件夹]导入前坐标[${idx}]:`, Array.isArray(coordsBefore) && coordsBefore[0] ? 
                                    (Array.isArray(coordsBefore[0]) ? coordsBefore[0][0] : coordsBefore[0]) : coordsBefore);
                                
                                const feature = format.readFeature(featureData, {
                                    featureProjection: 'EPSG:3857',
                                    dataProjection: 'EPSG:4326'
                                });
                                
                                // 调试：导入后的坐标
                                const geomAfter = feature.getGeometry();
                                const coordsAfter = geomAfter.getType() === 'Polygon' ? 
                                    geomAfter.getCoordinates()[0][0] : geomAfter.getCoordinates();
                                console.log(`[文件夹]导入后坐标[${idx}]:`, coordsAfter);
                                
                                const featureId = 'assist_imported_' + Date.now() + '_' + idx;
                                feature.setId(featureId);
                                feature.set('isAssistFeature', true);
                                feature.set('sourceFileName', file.name);
                                feature.set('assistFileId', fileId);
                                
                                const olGeometryType = feature.getGeometry().getType();
                                const propsType = featureData.properties && featureData.properties.type;
                                
                                if (propsType === 'assistLine' || olGeometryType === 'LineString') {
                                    restoreFeatureStyle(feature, featureData);
                                    lineSource.addFeature(feature);
                                    importedFeatures.push(feature);
                                }
                                else if (propsType === 'assistPoint' || (featureData.properties && featureData.properties.iconType)) {
                                    if (featureData.properties) {
                                        if (featureData.properties.iconType) feature.set('iconType', featureData.properties.iconType);
                                        if (featureData.properties.iconColor) feature.set('iconColor', featureData.properties.iconColor);
                                        if (featureData.properties.iconSize) feature.set('iconSize', featureData.properties.iconSize);
                                        if (featureData.properties.text) feature.set('text', featureData.properties.text);
                                        if (featureData.properties.textColor) feature.set('textColor', featureData.properties.textColor);
                                    }
                                    assistPointSource.addFeature(feature);
                                    importedFeatures.push(feature);
                                }
                                else if (propsType === 'assistText' || (olGeometryType === 'Point' && featureData.properties && featureData.properties.text && !featureData.properties.iconType)) {
                                    if (featureData.properties && featureData.properties.text) {
                                        feature.set('text', featureData.properties.text);
                                    }
                                    restoreFeatureStyle(feature, featureData);
                                    assistTextSource.addFeature(feature);
                                    importedFeatures.push(feature);
                                }
                                else if (propsType === 'assistPolygon' || olGeometryType === 'Polygon') {
                                    if (featureData.properties && featureData.properties.name) {
                                        feature.set('name', featureData.properties.name);
                                    }
                                    restoreFeatureStyle(feature, featureData);
                                    assistPolygonSource.addFeature(feature);
                                    importedFeatures.push(feature);
                                }
                            } catch (featureError) {
                                console.warn(`跳过无效要素:`, featureError.message);
                            }
                        });
                        
                        if (importedFeatures.length > 0) {
                            assistFile.featureCount = importedFeatures.length;
                            AppState.assistFiles.push(assistFile);
                            AppState.assistFeatureMap.set(fileId, importedFeatures);
                            importedCount++;
                        }
                        
                    } catch (error) {
                        console.error(`导入文件 ${file.name} 失败:`, error);
                        failedCount++;
                    }
                    
                    processedCount++;
                    checkComplete();
                };
                
                reader.onerror = function() {
                    console.error(`读取文件 ${file.name} 失败`);
                    failedCount++;
                    processedCount++;
                    checkComplete();
                };
                
                reader.readAsText(file);
            }, index * 100); // 间隔100ms避免冲突
        });
        
        function checkComplete() {
            if (processedCount === geojsonFiles.length) {
                updateAssistFileList();
                updateToggleAllAssistButton();
                updateStatus();
                
                if (importedCount > 0 && AppState.assistFiles.length > 0) {
                    selectAssistFile(AppState.assistFiles[AppState.assistFiles.length - 1].id);
                    
                    // 缩放到所有导入数据的范围
                    const extent = ol.extent.createEmpty();
                    AppState.assistFiles.forEach(file => {
                        const features = AppState.assistFeatureMap.get(file.id) || [];
                        features.forEach(feature => {
                            const geometry = feature.getGeometry();
                            if (geometry) {
                                ol.extent.extend(extent, geometry.getExtent());
                            }
                        });
                    });
                    
                    if (extent && extent[0] !== Infinity) {
                        map.getView().fit(extent, {
                            padding: [50, 50, 50, 50],
                            maxZoom: 15,
                            duration: 1000
                        });
                    }
                }
                
                let msgParts = [];
                if (importedCount > 0) msgParts.push(`成功 ${importedCount} 个`);
                if (failedCount > 0) msgParts.push(`失败 ${failedCount} 个`);
                
                showMessage(`辅助元素文件夹导入完成: ${msgParts.join(', ')}`, importedCount > 0 ? 'success' : 'warning');
            }
        }
        
        event.target.value = '';
    }
    
    // ========== 导出辅助要素 ==========
    function exportAssistFeatures() {
        const lineCount = lineSource.getFeatures().length;
        const polygonCount = assistPolygonSource.getFeatures().length;
        const textCount = assistTextSource.getFeatures().length;
        const pointCount = assistPointSource.getFeatures().length;
        const totalCount = lineCount + polygonCount + textCount + pointCount;
        
        if (totalCount === 0) {
            showMessage('没有辅助要素可导出', 'warning');
            return;
        }
        
        try {
            const geoJSON = {
                type: 'FeatureCollection',
                features: [],
                properties: {
                    description: 'GIS-APP 辅助要素导出',
                    exportTime: new Date().toLocaleString(),
                    assistElements: {
                        lines: lineCount,
                        polygons: polygonCount,
                        texts: textCount,
                        points: pointCount
                    },
                    fileCount: AppState.assistFiles.length
                }
            };
            
            const format = new ol.format.GeoJSON();
            
            // 导出辅助线
            lineSource.getFeatures().forEach(function(feature, index) {
                const geoJSONFeature = format.writeFeatureObject(feature, {
                    featureProjection: 'EPSG:3857',
                    dataProjection: 'EPSG:4326'
                });
                geoJSONFeature.properties = geoJSONFeature.properties || {};
                geoJSONFeature.properties.type = 'assistLine';
                geoJSONFeature.properties.name = `辅助线_${index + 1}`;
                
                const styleProps = extractStyleFromFeature(feature, 'assistLine');
                Object.assign(geoJSONFeature.properties, styleProps);
                
                geoJSON.features.push(geoJSONFeature);
            });
            
            // 导出辅助多边形
            assistPolygonSource.getFeatures().forEach(function(feature, index) {
                // 调试：导出前的坐标
                const geomBefore = feature.getGeometry();
                const coordsBefore = geomBefore.getType() === 'Polygon' ? 
                    geomBefore.getCoordinates()[0][0] : geomBefore.getCoordinates();
                console.log(`[全部导出]多边形导出前坐标[${index}]:`, coordsBefore);
                
                const geoJSONFeature = format.writeFeatureObject(feature, {
                    featureProjection: 'EPSG:3857',
                    dataProjection: 'EPSG:4326'
                });
                
                // 调试：导出后的坐标
                const coordsAfter = geoJSONFeature.geometry.coordinates;
                console.log(`[全部导出]多边形导出后坐标[${index}]:`, Array.isArray(coordsAfter) && coordsAfter[0] ? coordsAfter[0][0] : coordsAfter);
                
                geoJSONFeature.properties = geoJSONFeature.properties || {};
                geoJSONFeature.properties.type = 'assistPolygon';
                
                const customName = feature.get('name');
                geoJSONFeature.properties.name = customName || `辅助多边形_${index + 1}`;
                
                const styleProps = extractStyleFromFeature(feature, 'assistPolygon');
                Object.assign(geoJSONFeature.properties, styleProps);
                
                geoJSON.features.push(geoJSONFeature);
            });
            
            // 导出辅助文字
            assistTextSource.getFeatures().forEach(function(feature, index) {
                const geoJSONFeature = format.writeFeatureObject(feature, {
                    featureProjection: 'EPSG:3857',
                    dataProjection: 'EPSG:4326'
                });
                geoJSONFeature.properties = geoJSONFeature.properties || {};
                geoJSONFeature.properties.type = 'assistText';
                geoJSONFeature.properties.name = `辅助文字_${index + 1}`;
                
                const styleProps = extractStyleFromFeature(feature, 'assistText');
                Object.assign(geoJSONFeature.properties, styleProps);
                
                geoJSON.features.push(geoJSONFeature);
            });
            
            // 导出辅助点
            assistPointSource.getFeatures().forEach(function(feature, index) {
                const geoJSONFeature = format.writeFeatureObject(feature, {
                    featureProjection: 'EPSG:3857',
                    dataProjection: 'EPSG:4326'
                });
                geoJSONFeature.properties = geoJSONFeature.properties || {};
                geoJSONFeature.properties.type = 'assistPoint';
                geoJSONFeature.properties.name = `辅助点_${index + 1}`;
                
                geoJSONFeature.properties.iconType = feature.get('iconType') || 'default';
                geoJSONFeature.properties.iconColor = feature.get('iconColor') || '#e74c3c';
                geoJSONFeature.properties.iconSize = feature.get('iconSize') || 1.0;
                
                const text = feature.get('text');
                if (text) {
                    geoJSONFeature.properties.text = text;
                    geoJSONFeature.properties.textColor = feature.get('textColor') || '#333333';
                }
                
                geoJSON.features.push(geoJSONFeature);
            });
            
            const dataStr = JSON.stringify(geoJSON, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const fileName = `辅助要素_全部_${timestamp}.geojson`;
            
            const link = document.createElement('a');
            link.setAttribute('href', dataUri);
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showMessage(`导出成功: ${fileName} (${totalCount} 个要素，来自 ${AppState.assistFiles.length} 个文件)`, 'success');
            
        } catch (error) {
            console.error('导出辅助要素失败:', error);
            showMessage('导出失败: ' + error.message, 'error');
        }
    }
    
    function stopDrawing() {
        if (drawInteraction) {
            map.removeInteraction(drawInteraction);
            drawInteraction = null;
        }
        
        // 移除地图点击处理器
        if (AppState.mapClickHandler) {
            map.un('click', AppState.mapClickHandler);
            AppState.mapClickHandler = null;
        }
        
        // 如果在辅助多边形编辑模式，也要退出
        if (AppState.currentMode === 'editAssistPolygon') {
            stopAssistPolygonEdit();
            return;
        }
        
        // 如果在辅助选择模式，也要退出
        if (AppState.currentMode === 'assistSelect') {
            stopAssistSelectMode();
            return;
        }
        
        // 如果在测量模式，也要退出
        if (AppState.measureMode) {
            stopMeasure();
        }
        
        AppState.currentMode = 'browse';
        AppState.isDrawing = false;
        
        updateToolbarButtons();
        updateStatus();
    }
    
    function updateToolbarButtons() {
        // 重置所有按钮状态
        $('#drawPolygon, #drawAssistLine, #drawAssistPolygon, #drawAssistText, #drawAssistPoint, #selectPolygon, #editPolygon, #selectAssistFeature, #editAssistPolygon, #measureLength, #measureArea').removeClass('active');
        
        // 设置当前激活的按钮
        if (AppState.currentMode === 'drawPolygon') {
            $('#drawPolygon').addClass('active');
        } else if (AppState.currentMode === 'drawLine') {
            $('#drawAssistLine').addClass('active');
        } else if (AppState.currentMode === 'drawAssistPolygon') {
            $('#drawAssistPolygon').addClass('active');
        } else if (AppState.currentMode === 'drawAssistText') {
            $('#drawAssistText').addClass('active');
        } else if (AppState.currentMode === 'drawAssistPoint') {
            $('#drawAssistPoint').addClass('active');
        } else if (AppState.currentMode === 'select') {
            $('#selectPolygon').addClass('active');
        } else if (AppState.currentMode === 'editPolygon') {
            $('#editPolygon').addClass('active');
        } else if (AppState.currentMode === 'assistSelect') {
            $('#selectAssistFeature').addClass('active');
        } else if (AppState.currentMode === 'editAssistPolygon') {
            $('#editAssistPolygon').addClass('active');
        }
        
        // 测量按钮状态
        if (AppState.measureMode === 'length') {
            $('#measureLength').addClass('active');
        } else if (AppState.measureMode === 'area') {
            $('#measureArea').addClass('active');
        }
    }
    
    // ========== 编辑功能 ==========
    function startSelectMode() {
        stopDrawing();
        stopEditPolygon();
        
        selectInteraction.setActive(true);
        AppState.currentMode = 'select';
        updateToolbarButtons();
        updateStatus();
        
        showMessage('选择模式已激活，点击多边形进行选择', 'info');
    }
    
    function startEditPolygon() {
        if (!AppState.selectedFeature) {
            showMessage('请先选择多边形', 'warning');
            return;
        }
        
        // 检查选中的要素是否属于当前文件
        const featureFileId = AppState.selectedFeature.get('sourceFileId');
        if (!AppState.selectedJSONFile || featureFileId !== AppState.selectedJSONFile.id) {
            showMessage('只能编辑当前选中文件中的多边形', 'warning');
            return;
        }
        
        stopDrawing();
        
        modifyInteraction.setActive(true);
        AppState.currentMode = 'editPolygon';
        updateToolbarButtons();
        updateStatus();
        
        // 重置顶点选择
        AppState.selectedVertexIndex = null;
        AppState.selectedVertexCoordinates = null;
        
        showMessage('编辑模式已激活。拖动顶点调整形状，点击顶点可选中后删除', 'info');
    }
    
    function stopEditPolygon() {
        modifyInteraction.setActive(false);
        AppState.currentMode = AppState.selectedFeature ? 'select' : 'browse';
        updateToolbarButtons();
        updateStatus();
        
        // 重置顶点选择
        AppState.selectedVertexIndex = null;
        AppState.selectedVertexCoordinates = null;
    }
    
    function toggleEditPolygon() {
        if (AppState.currentMode === 'editPolygon') {
            stopEditPolygon();
        } else {
            startEditPolygon();
        }
    }
    
    function deleteSelectedPolygon() {
        if (!AppState.selectedFeature) {
            showMessage('请先选择多边形', 'warning');
            return;
        }
        
        // 检查选中的要素是否属于当前文件
        const featureFileId = AppState.selectedFeature.get('sourceFileId');
        if (!AppState.selectedJSONFile || featureFileId !== AppState.selectedJSONFile.id) {
            showMessage('只能删除当前选中文件中的多边形', 'warning');
            return;
        }
        
        if (confirm('删除选中多边形？')) {
            const featureId = AppState.selectedFeature.getId();
            
            // 从数据源中删除
            vectorSource.removeFeature(AppState.selectedFeature);
            
            // 从对应文件的要素列表中移除
            const features = AppState.jsonFeatureMap.get(featureFileId) || [];
            const index = features.findIndex(f => f.getId() === featureId);
            if (index !== -1) {
                features.splice(index, 1);
            }
            
            // 更新文件计数
            const jsonFile = AppState.jsonFiles.find(f => f.id === featureFileId);
            if (jsonFile) {
                jsonFile.featureCount = features.length;
            }
            
            // 删除多边形名称记录
            if (AppState.polygonNames[featureId]) {
                delete AppState.polygonNames[featureId];
            }
            
            AppState.selectedFeature = null;
            selectInteraction.getFeatures().clear();
            
            updateJSONFileList();
            updateStatus();
            
            showMessage('多边形已删除', 'success');
        }
    }
    
    // ========== 数据管理 ==========
    function exportToGeoJSON() {
        // 如果没有选中的文件，提示用户
        if (!AppState.selectedJSONFile) {
            showMessage('请先选择一个学区文件', 'warning');
            return;
        }
        
        const fileId = AppState.selectedJSONFile.id;
        const featuresToExport = AppState.jsonFeatureMap.get(fileId) || [];
        const exportFileName = AppState.selectedJSONFile.name.replace(/\.[^/.]+$/, '') + '.geojson';
        
        if (featuresToExport.length === 0) {
            showMessage('选中的学区文件中没有多边形可导出', 'warning');
            return;
        }
        
        console.log('导出文件:', AppState.selectedJSONFile.name);
        console.log('导出要素数量:', featuresToExport.length);
        
        try {
            const geoJSON = {
                type: 'FeatureCollection',
                features: []
            };
            
            const format = new ol.format.GeoJSON();
            
            featuresToExport.forEach(function(feature) {
                const geoJSONFeature = format.writeFeatureObject(feature, {
                    featureProjection: 'EPSG:3857',
                    dataProjection: 'EPSG:4326'
                });
                
                // 保存多边形的自定义属性
                const featureId = feature.getId();
                const featureName = feature.get('name');
                const sourceFileName = feature.get('sourceFileName');
                
                geoJSONFeature.properties = geoJSONFeature.properties || {};
                if (featureName) {
                    geoJSONFeature.properties.name = featureName;
                }
                geoJSONFeature.properties.id = featureId;
                geoJSONFeature.properties.sourceFile = sourceFileName;
                
                geoJSON.features.push(geoJSONFeature);
            });
            
            // 添加文件级别的元数据，包括标星状态
            geoJSON.properties = {
                fileName: AppState.selectedJSONFile.name,
                exportTime: new Date().toLocaleString(),
                isStarred: AppState.starredFiles.has(fileId)
            };
            
            const dataStr = JSON.stringify(geoJSON, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            
            const link = document.createElement('a');
            link.setAttribute('href', dataUri);
            link.setAttribute('download', exportFileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            console.log('导出成功，文件:', exportFileName);
            showMessage(`导出成功: ${exportFileName}`, 'success');
            
        } catch (error) {
            console.error('导出失败:', error);
            showMessage('导出失败: ' + error.message, 'error');
        }
    }
    
    function importGeoJSON() {
        $('#geoJSONFile').click();
    }
    
    // 导入文件夹
    function importGeoJSONFolder() {
        $('#geoJSONFolder').click();
    }
    
    // 检测是否为辅助要素文件（通过文件名或内容）
    function isAssistFeatureFile(fileName, geoJSONData) {
        // 1. 检查文件名关键词
        const assistFileNameKeywords = ['辅助要素', 'assist', '辅助线', '辅助多边形', '辅助文字', '辅助点'];
        const lowerFileName = fileName.toLowerCase();
        for (const keyword of assistFileNameKeywords) {
            if (lowerFileName.includes(keyword.toLowerCase())) {
                return { isAssist: true, reason: '文件名包含关键词: ' + keyword };
            }
        }
        
        // 2. 检查文件内容 - 如果所有要素都是辅助要素类型
        if (geoJSONData.features && geoJSONData.features.length > 0) {
            const assistTypes = ['assistLine', 'assistPolygon', 'assistText', 'assistPoint'];
            let allFeaturesAreAssist = true;
            let assistFeatureCount = 0;
            
            for (const feature of geoJSONData.features) {
                const type = feature.properties && feature.properties.type;
                const geometryType = feature.geometry && feature.geometry.type;
                
                // 检查是否明确标记为辅助要素类型
                if (type && assistTypes.includes(type)) {
                    assistFeatureCount++;
                } 
                // 检查是否有图标类型（辅助点特征）
                else if (feature.properties && feature.properties.iconType) {
                    assistFeatureCount++;
                }
                // Point类型且有text但没有name，可能是辅助文字
                else if (geometryType === 'Point' && 
                         feature.properties && 
                         feature.properties.text && 
                         !feature.properties.name) {
                    assistFeatureCount++;
                }
                else {
                    allFeaturesAreAssist = false;
                    break;
                }
            }
            
            // 如果所有要素都是辅助要素，判定为辅助要素文件
            if (allFeaturesAreAssist && assistFeatureCount > 0) {
                return { isAssist: true, reason: `文件内容全部为辅助要素 (${assistFeatureCount}个)` };
            }
        }
        
        return { isAssist: false };
    }
    
    // 处理文件夹导入（多个文件）
    function handleGeoJSONFolderImport(event) {
        const files = Array.from(event.target.files);
        
        // 过滤出geojson文件
        const geojsonFiles = files.filter(file => 
            file.name.toLowerCase().endsWith('.geojson') || 
            file.name.toLowerCase().endsWith('.json')
        );
        
        if (geojsonFiles.length === 0) {
            showMessage('文件夹中没有找到GeoJSON文件', 'warning');
            return;
        }
        
        console.log(`准备导入文件夹中的 ${geojsonFiles.length} 个GeoJSON文件`);
        showMessage(`开始导入 ${geojsonFiles.length} 个文件...`, 'info');
        
        let importedCount = 0;
        let skippedCount = 0;  // 跳过的辅助要素文件
        let failedCount = 0;
        let processedCount = 0;
        const skippedFiles = [];  // 记录被跳过的文件名
        
        // 依次处理每个文件
        geojsonFiles.forEach((file, index) => {
            const reader = new FileReader();
            
            reader.onload = function(e) {
                try {
                    const geoJSONData = JSON.parse(e.target.result);
                    
                    // 验证GeoJSON格式
                    if (!geoJSONData.type || geoJSONData.type !== 'FeatureCollection') {
                        throw new Error('无效的GeoJSON格式');
                    }
                    
                    if (!Array.isArray(geoJSONData.features)) {
                        throw new Error('缺少features数组');
                    }
                    
                    // 检查是否是辅助要素文件（文件名+内容双重检测）
                    const assistCheck = isAssistFeatureFile(file.name, geoJSONData);
                    
                    if (assistCheck.isAssist) {
                        console.warn(`跳过辅助要素文件: ${file.name}, 原因: ${assistCheck.reason}`);
                        skippedFiles.push(file.name);
                        skippedCount++;
                        processedCount++;
                        checkComplete();
                        return;
                    }
                    
                    const format = new ol.format.GeoJSON();
                    const importedFeatures = [];
                    
                    // 检查文件元数据中的标星状态
                    const isStarredFromFile = geoJSONData.properties && geoJSONData.properties.isStarred === true;
                    
                    // 创建新的JSON文件记录
                    const fileId = 'file_' + Date.now() + '_' + index;
                    const jsonFile = {
                        id: fileId,
                        name: file.name,
                        importTime: new Date().toLocaleString(),
                        featureCount: 0
                    };
                    
                    // 如果文件本身标记为标星，则添加到标星列表
                    if (isStarredFromFile) {
                        AppState.starredFiles.add(fileId);
                    }
                    
                    // 解析GeoJSON要素
                    geoJSONData.features.forEach(function(featureData, idx) {
                        try {
                            const feature = format.readFeature(featureData, {
                                featureProjection: 'EPSG:3857',
                                dataProjection: 'EPSG:4326'
                            });
                            
                            // 检查是否为辅助要素
                            const type = featureData.properties && featureData.properties.type;
                            if (type === 'assistLine' || type === 'assistPolygon' || type === 'assistText' || type === 'assistPoint') {
                                return;
                            }
                            
                            // 设置唯一ID
                            const featureId = 'imported_' + Date.now() + '_' + index + '_' + idx;
                            feature.setId(featureId);
                            
                            // 标记该要素属于新导入的文件
                            feature.set('sourceFileId', fileId);
                            feature.set('sourceFileName', file.name);
                            feature.set('isAssistFeature', false);
                            
                            // 读取并设置多边形名称
                            if (featureData.properties && featureData.properties.name) {
                                const featureName = featureData.properties.name;
                                feature.set('name', featureName);
                                AppState.polygonNames[featureId] = featureName;
                            }
                            
                            vectorSource.addFeature(feature);
                            importedFeatures.push(feature);
                            
                        } catch (featureError) {
                            console.warn(`跳过无效要素:`, featureError.message);
                        }
                    });
                    
                    // 更新文件记录
                    jsonFile.featureCount = importedFeatures.length;
                    AppState.jsonFiles.push(jsonFile);
                    AppState.jsonFeatureMap.set(fileId, importedFeatures);
                    importedCount++;
                    
                } catch (error) {
                    console.error(`导入文件 ${file.name} 失败:`, error);
                    failedCount++;
                }
                
                processedCount++;
                checkComplete();
            };
            
            reader.onerror = function() {
                console.error(`读取文件 ${file.name} 失败`);
                failedCount++;
                processedCount++;
                checkComplete();
            };
            
            reader.readAsText(file);
        });
        
        function checkComplete() {
            if (processedCount === geojsonFiles.length) {
                // 所有文件处理完成
                updateJSONFileList();
                updateToggleAllButton();
                
                // 如果有导入成功的文件，选中最后一个
                if (importedCount > 0 && AppState.jsonFiles.length > 0) {
                    selectJSONFile(AppState.jsonFiles[AppState.jsonFiles.length - 1].id);
                    
                    // 缩放到所有导入数据的范围
                    const extent = ol.extent.createEmpty();
                    let hasValidExtent = false;
                    AppState.jsonFiles.forEach(file => {
                        const features = AppState.jsonFeatureMap.get(file.id) || [];
                        features.forEach(feature => {
                            const geometry = feature.getGeometry();
                            if (geometry) {
                                ol.extent.extend(extent, geometry.getExtent());
                                hasValidExtent = true;
                            }
                        });
                    });
                    
                    if (hasValidExtent && extent[0] !== Infinity) {
                        map.getView().fit(extent, {
                            padding: [50, 50, 50, 50],
                            maxZoom: 15,
                            duration: 1000
                        });
                    }
                }
                
                // 构建详细的提示信息
                let msgParts = [];
                if (importedCount > 0) msgParts.push(`成功 ${importedCount} 个`);
                if (skippedCount > 0) msgParts.push(`跳过 ${skippedCount} 个辅助要素文件`);
                if (failedCount > 0) msgParts.push(`失败 ${failedCount} 个`);
                
                const msg = `文件夹导入完成: ${msgParts.join(', ')}`;
                console.log(msg);
                if (skippedFiles.length > 0) {
                    console.log('跳过的辅助要素文件:', skippedFiles);
                }
                
                const msgType = importedCount > 0 ? 'success' : (skippedCount > 0 ? 'info' : 'warning');
                showMessage(msg, msgType);
            }
        }
        
        // 重置文件输入
        event.target.value = '';
    }
    
    function handleGeoJSONImport(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const geoJSONData = JSON.parse(e.target.result);
                
                console.log('导入多边形文件:', file.name);
                
                // 验证GeoJSON格式
                if (!geoJSONData.type || geoJSONData.type !== 'FeatureCollection') {
                    throw new Error('无效的GeoJSON格式：必须是FeatureCollection类型');
                }
                
                if (!Array.isArray(geoJSONData.features)) {
                    throw new Error('无效的GeoJSON格式：缺少features数组');
                }
                
                // ===== 辅助要素文件检测 =====
                // 检查文件名是否包含"辅助要素"关键词
                const isAssistFileByName = file.name.includes('辅助要素') || 
                                             file.name.toLowerCase().includes('assist');
                
                // 检查是否所有要素都是辅助要素类型
                let assistFeatureCount = 0;
                geoJSONData.features.forEach(featureData => {
                    const type = featureData.properties && featureData.properties.type;
                    const geomType = featureData.geometry && featureData.geometry.type;
                    // LineString但不是多边形文件常见的类型，或明确标记为辅助要素
                    if (type === 'assistLine' || type === 'assistPolygon' || type === 'assistText' ||
                        type === 'line' || type === 'text') {
                        assistFeatureCount++;
                    }
                });
                const isAssistFileByContent = assistFeatureCount > 0 && 
                                               assistFeatureCount === geoJSONData.features.length;
                
                // 如果检测到可能是辅助要素文件，提示用户
                if (isAssistFileByName || isAssistFileByContent) {
                    console.warn('检测到可能是辅助要素文件:', file.name);
                    showMessage('检测到辅助要素文件，请使用工具栏中的"导入辅助要素"按钮导入', 'warning');
                    // 不处理此文件，让用户用正确的功能导入
                    event.target.value = '';
                    return;
                }
                
                // 检查文件元数据中的标星状态
                const isStarredFromFile = geoJSONData.properties && geoJSONData.properties.isStarred === true;
                
                const format = new ol.format.GeoJSON();
                let successCount = 0;
                const importedFeatures = [];
                
                // 创建新的JSON文件记录
                const fileId = 'file_' + Date.now();
                const jsonFile = {
                    id: fileId,
                    name: file.name,
                    importTime: new Date().toLocaleString(),
                    featureCount: 0
                };
                
                // 如果文件本身标记为标星，则添加到标星列表
                if (isStarredFromFile) {
                    AppState.starredFiles.add(fileId);
                }
                
                // 解析GeoJSON要素
                geoJSONData.features.forEach(function(featureData, index) {
                    try {
                        const feature = format.readFeature(featureData, {
                            featureProjection: 'EPSG:3857',
                            dataProjection: 'EPSG:4326'
                        });
                        
                        // 检查是否为辅助要素
                        const type = featureData.properties && featureData.properties.type;
                        if (type === 'assistLine' || type === 'assistPolygon' || type === 'assistText') {
                            console.warn(`⚠ 跳过辅助要素（应使用辅助要素导入功能）: type=${type}`);
                            return;
                        }
                        
                        // 设置唯一ID
                        const importTimestamp = Date.now();
                        let featureId = feature.getId();
                        if (!featureId) {
                            featureId = 'imported_' + importTimestamp + '_' + index;
                        } else {
                            featureId = featureId + '_imported_' + importTimestamp;
                        }
                        feature.setId(featureId);
                        
                        // 标记该要素属于新导入的文件
                        feature.set('sourceFileId', fileId);
                        feature.set('sourceFileName', file.name);
                        
                        // 标记为非辅助要素
                        feature.set('isAssistFeature', false);
                        
                        // 读取并设置多边形名称
                        if (featureData.properties && featureData.properties.name) {
                            const featureName = featureData.properties.name;
                            feature.set('name', featureName);
                            AppState.polygonNames[featureId] = featureName;
                        }
                        
                        vectorSource.addFeature(feature);
                        importedFeatures.push(feature);
                        successCount++;
                        
                    } catch (featureError) {
                        console.warn(`跳过无效要素 ${index}:`, featureError.message);
                    }
                });
                
                // 更新文件记录
                jsonFile.featureCount = successCount;
                AppState.jsonFiles.push(jsonFile);
                AppState.jsonFeatureMap.set(fileId, importedFeatures);
                
                // 更新文件列表并选中新导入的文件
                updateJSONFileList();
                updateToggleAllButton();
                selectJSONFile(fileId);
                
                // 居中显示新导入的数据
                if (successCount > 0 && importedFeatures.length > 0) {
                    const extent = ol.extent.createEmpty();
                    importedFeatures.forEach(feature => {
                        const geometry = feature.getGeometry();
                        if (geometry) {
                            ol.extent.extend(extent, geometry.getExtent());
                        }
                    });
                    
                    if (extent && extent[0] !== Infinity) {
                        map.getView().fit(extent, {
                            padding: [50, 50, 50, 50],
                            maxZoom: 15,
                            duration: 1000
                        });
                    }
                }
                
                const message = `成功导入 ${successCount} 个多边形要素从学区文件 ${file.name}`;
                console.log(message);
                showMessage(message, 'success');
                
            } catch (error) {
                console.error('导入失败:', error);
                showMessage('导入失败：' + error.message, 'error');
            }
        };
        
        reader.onerror = function() {
            showMessage('读取文件失败，请重试', 'error');
        };
        
        reader.readAsText(file);
        
        // 重置文件输入
        event.target.value = '';
    }
    
    // ========== POI搜索 ==========
    function searchPlace() {
        const query = $('#searchInput').val().trim();
        
        if (!query) {
            showMessage('请输入搜索词', 'warning');
            return;
        }
        
        console.log('开始POI搜索:', query);
        
        $('#searchBtn').html('<i class="fas fa-spinner fa-spin"></i>');
        $('#searchResults').html('<div class="search-result-item">搜索中...</div>');
        $('#searchResultsPanel').addClass('show');
        
        searchSource.clear();
        AppState.searchResults = [];
        
        let currentKey = TiandituKeyManager.getCurrentKey();
        
        const makeSearchRequest = (key) => {
            const searchParams = {
                query: query,
                type: 'query',
                postStr: JSON.stringify({
                    keyWord: query,
                    level: 11,
                    mapBound: '112,27,113,28',
                    queryType: 1,
                    count: 20,
                    start: 0
                }),
                tk: key
            };
            
            const queryString = Object.keys(searchParams)
                .map(key => `${key}=${encodeURIComponent(searchParams[key])}`)
                .join('&');
            
            return fetch(`${CONFIG.POI_SEARCH_API}?${queryString}`)
                .then(response => response.json());
        };
        
        const trySearch = (attempt = 0) => {
            makeSearchRequest(currentKey)
                .then(data => {
                    // 检查是否因配额超限失败
                    if (data.status && (data.status === '7' || data.status === '100' || 
                        data.status.infocode === '10004' || data.status.infocode === '10002' ||
                        (data.msg && (data.msg.includes('limit') || data.msg.includes('配额'))))) {
                        if (attempt < TiandituKeyManager.keys.length - 1) {
                            console.warn(`[KEY轮换] 搜索API KEY超限，尝试下一个`);
                            currentKey = TiandituKeyManager.getNextKey();
                            trySearch(attempt + 1);
                            return;
                        }
                    }
                    
                    if (data.status && data.status.infocode !== 1000) {
                        $('#searchResults').html(`<div class="search-result-item">API错误: ${data.status.info}</div>`);
                        showMessage('搜索失败: ' + (data.status.info || '未知错误'), 'error');
                        return;
                    }
                    
                    let pois = [];
                    if (data.pois && Array.isArray(data.pois)) {
                        pois = data.pois;
                    }
                    
                    if (pois.length === 0) {
                        $('#searchResults').html('<div class="search-result-item">未找到相关结果</div>');
                        showMessage(`未找到与"${query}"相关的结果`, 'warning');
                        return;
                    }
                
                AppState.searchResults = pois;
                
                const $searchResults = $('#searchResults');
                $searchResults.empty();
                
                pois.forEach((poi, index) => {
                    const name = poi.name || '未知地点';
                    const address = poi.address || '无地址信息';
                    
                    let lon, lat;
                    if (poi.lonlat && typeof poi.lonlat === 'string') {
                        const [lonStr, latStr] = poi.lonlat.split(',');
                        lon = parseFloat(lonStr.trim());
                        lat = parseFloat(latStr.trim());
                    }
                    
                    const resultItem = $(`
                        <div class="search-result-item" data-index="${index}">
                            <div style="font-weight:600;color:#2c3e50;">${name}</div>
                            <div style="font-size:12px;color:#666;">${address}</div>
                        </div>
                    `);
                    
                    resultItem.on('click', function() {
                        zoomToSearchResult(index);
                    });
                    
                    $searchResults.append(resultItem);
                    
                    if (!isNaN(lon) && !isNaN(lat)) {
                        const point = new ol.geom.Point(ol.proj.fromLonLat([lon, lat]));
                        const feature = new ol.Feature({
                            geometry: point,
                            name: name,
                            address: address
                        });
                        feature.setId('search_' + index);
                        searchSource.addFeature(feature);
                    }
                });
                
                if (pois.length > 0) {
                    setTimeout(() => {
                        zoomToSearchResult(0);
                    }, 500);
                }
                
                    showMessage(`找到 ${pois.length} 个结果`, 'success');
                })
                .catch(error => {
                    console.error('[搜索] 请求失败:', error);
                    // 尝试下一个KEY
                    if (attempt < TiandituKeyManager.keys.length - 1) {
                        currentKey = TiandituKeyManager.getNextKey();
                        trySearch(attempt + 1);
                        return;
                    }
                    
                    $('#searchResults').html(`<div class="search-result-item">搜索失败: ${error.message}</div>`);
                    showMessage('搜索失败: ' + error.message, 'error');
                })
                .finally(() => {
                    $('#searchBtn').html('<i class="fas fa-search"></i>');
                });
        };
        
        trySearch();
    }
    
    function zoomToSearchResult(index) {
        if (!AppState.searchResults || !AppState.searchResults[index]) {
            return;
        }
        
        const poi = AppState.searchResults[index];
        let lon, lat;
        
        if (poi.lonlat && typeof poi.lonlat === 'string') {
            const [lonStr, latStr] = poi.lonlat.split(',');
            lon = parseFloat(lonStr.trim());
            lat = parseFloat(latStr.trim());
        }
        
        if (isNaN(lon) || isNaN(lat)) {
            return;
        }
        
        const center = ol.proj.fromLonLat([lon, lat]);
        const poiName = poi.name || '未知地点';
        
        // 获取当前缩放级别，计算目标缩放级别
        const currentZoom = map.getView().getZoom();
        const targetZoom = Math.max(currentZoom, 16); // 至少缩放到16级
        
        // 先平移到目标位置，然后缩放
        map.getView().animate({
            center: center,
            duration: 600,
            easing: ol.easing.easeOut
        }, function() {
            // 平移完成后进行缩放
            map.getView().animate({
                zoom: targetZoom,
                duration: 400,
                easing: ol.easing.easeOut
            });
        });
        
        // 高亮显示搜索结果
        highlightSearchResult(index);
        
        showMessage(`定位到: ${poiName} (缩放级别: ${targetZoom})`, 'info');
    }
    
    // 高亮显示搜索结果
    function highlightSearchResult(index) {
        // 清除之前的高亮
        if (highlightSource) {
            highlightSource.clear();
        }
        
        const poi = AppState.searchResults[index];
        if (!poi || !poi.lonlat) return;
        
        const [lonStr, latStr] = poi.lonlat.split(',');
        const lon = parseFloat(lonStr.trim());
        const lat = parseFloat(latStr.trim());
        
        if (isNaN(lon) || isNaN(lat)) return;
        
        // 创建高亮点
        const coordinate = ol.proj.fromLonLat([lon, lat]);
        const highlightFeature = new ol.Feature({
            geometry: new ol.geom.Point(coordinate)
        });
        highlightFeature.setId('highlight_' + index);
        
        // 创建高亮样式（红色脉冲效果）
        const highlightStyle = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 12,
                fill: new ol.style.Fill({
                    color: 'rgba(231, 76, 60, 0.6)'
                }),
                stroke: new ol.style.Stroke({
                    color: '#e74c3c',
                    width: 3
                })
            })
        });
        
        highlightFeature.setStyle(highlightStyle);
        
        // 如果高亮源不存在，创建一个
        if (!highlightSource) {
            highlightSource = new ol.source.Vector();
            const highlightLayer = new ol.layer.Vector({
                source: highlightSource,
                zIndex: 1000
            });
            map.addLayer(highlightLayer);
        }
        
        highlightSource.clear();
        highlightSource.addFeature(highlightFeature);
        
        // 3秒后移除高亮
        setTimeout(function() {
            if (highlightSource) {
                highlightSource.clear();
            }
        }, 3000);
    }
    
    function clearSearchResults() {
        searchSource.clear();
        AppState.searchResults = [];
        if (highlightSource) {
            highlightSource.clear();
        }
        $('#searchResults').empty();
        $('#searchInput').val('');
        $('#searchResultsPanel').removeClass('show');
        updateStatus();
    }
    
    // ========== 测量功能 ==========
    
    // 格式化测量结果
    function formatMeasureResult(geometry) {
        const type = geometry.getType();
        let output;
        
        if (type === 'LineString') {
            const length = ol.sphere.getLength(geometry);
            if (length > 1000) {
                output = (length / 1000).toFixed(2) + ' km';
            } else {
                output = length.toFixed(2) + ' m';
            }
        } else if (type === 'Polygon') {
            const area = ol.sphere.getArea(geometry);
            if (area > 1000000) {
                output = (area / 1000000).toFixed(2) + ' km²';
            } else if (area > 10000) {
                output = (area / 10000).toFixed(2) + ' 公顷';
            } else {
                output = area.toFixed(2) + ' m²';
            }
        }
        
        return output;
    }
    
    // 创建测量提示框
    function createMeasureTooltip() {
        if (measureTooltipElement) {
            measureTooltipElement.parentNode.removeChild(measureTooltipElement);
        }
        measureTooltipElement = document.createElement('div');
        measureTooltipElement.className = 'measure-tooltip measure-tooltip-measure';
        measureTooltipElement.style.display = 'none';
        document.body.appendChild(measureTooltipElement);
        
        AppState.measureTooltip = new ol.Overlay({
            element: measureTooltipElement,
            offset: [0, -15],
            positioning: 'bottom-center'
        });
        map.addOverlay(AppState.measureTooltip);
    }
    
    // 创建帮助提示框
    function createHelpTooltip() {
        if (measureHelpTooltipElement) {
            measureHelpTooltipElement.parentNode.removeChild(measureHelpTooltipElement);
        }
        measureHelpTooltipElement = document.createElement('div');
        measureHelpTooltipElement.className = 'measure-tooltip measure-tooltip-help';
        document.body.appendChild(measureHelpTooltipElement);
        
        AppState.measureHelpTooltip = new ol.Overlay({
            element: measureHelpTooltipElement,
            offset: [15, 0],
            positioning: 'center-left'
        });
        map.addOverlay(AppState.measureHelpTooltip);
    }
    
    // 开始测距
    function startMeasureLength() {
        if (AppState.measureMode === 'length') {
            stopMeasure();
            return;
        }
        
        stopMeasure();
        stopDrawing();
        
        AppState.measureMode = 'length';
        createMeasureTooltip();
        createHelpTooltip();
        
        measureDrawInteraction = new ol.interaction.Draw({
            source: measureSource,
            type: 'LineString',
            maxPoints: 100, // 设置一个较大的最大点数，防止自动结束
            style: new ol.style.Style({
                fill: new ol.style.Fill({
                    color: 'rgba(255, 255, 255, 0.2)'
                }),
                stroke: new ol.style.Stroke({
                    color: '#ff6b6b',
                    width: 3,
                    lineDash: [10, 10]
                }),
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({
                        color: '#ff6b6b'
                    }),
                    stroke: new ol.style.Stroke({
                        color: 'white',
                        width: 2
                    })
                })
            })
        });
        
        // 添加双击结束绘制的逻辑
        let dblClickListener = function(event) {
            if (AppState.measureMode === 'length' && measureDrawInteraction) {
                // 检查是否至少有2个顶点
                const sketchFeature = measureDrawInteraction.sketchFeature_;
                if (sketchFeature && sketchFeature.getGeometry()) {
                    const geometry = sketchFeature.getGeometry();
                    const coordinates = geometry.getCoordinates();
                    if (coordinates.length >= 2) {
                        event.preventDefault();
                        event.stopPropagation();
                        measureDrawInteraction.finishDrawing();
                    }
                }
            }
        };
        
        // 在绘制开始时添加双击监听
        measureDrawInteraction.on('drawstart', function() {
            map.on('dblclick', dblClickListener);
        });
        
        // 在绘制结束时移除双击监听
        measureDrawInteraction.on(['drawend', 'drawabort'], function() {
            map.un('dblclick', dblClickListener);
        });
        
        let sketch;
        let listener;
        
        measureDrawInteraction.on('drawstart', function(evt) {
            sketch = evt.feature;
            let tooltipCoord = evt.coordinate;
            
            listener = sketch.getGeometry().on('change', function(evt) {
                const geom = evt.target;
                let output = formatMeasureResult(geom);
                tooltipCoord = geom.getLastCoordinate();
                
                measureTooltipElement.innerHTML = output;
                AppState.measureTooltip.setPosition(tooltipCoord);
                measureTooltipElement.style.display = 'block';
            });
        });
        
        measureDrawInteraction.on('drawend', function(evt) {
            measureTooltipElement.className = 'measure-tooltip measure-tooltip-static';
            AppState.measureTooltip.setOffset([0, -7]);
            sketch = null;
            measureTooltipElement = null;
            ol.Observable.unByKey(listener);
            
            // 保存测量要素
            AppState.measureFeatures.push(evt.feature);
            
            // 重新创建提示框以便下一次测量
            createMeasureTooltip();
            
            showMessage('测距完成: ' + formatMeasureResult(evt.feature.getGeometry()), 'success');
        });
        
        // 鼠标移动提示
        map.on('pointermove', handleMeasurePointerMove);
        
        map.addInteraction(measureDrawInteraction);
        
        updateToolbarButtons();
        updateStatus();
        
        showMessage('测距模式：点击开始测量，双击结束', 'info');
    }
    
    // 开始测面
    function startMeasureArea() {
        if (AppState.measureMode === 'area') {
            stopMeasure();
            return;
        }
        
        stopMeasure();
        stopDrawing();
        
        AppState.measureMode = 'area';
        createMeasureTooltip();
        createHelpTooltip();
        
        measureDrawInteraction = new ol.interaction.Draw({
            source: measureSource,
            type: 'Polygon',
            maxPoints: 100, // 设置一个较大的最大点数，防止自动结束
            style: new ol.style.Style({
                fill: new ol.style.Fill({
                    color: 'rgba(255, 255, 255, 0.2)'
                }),
                stroke: new ol.style.Stroke({
                    color: '#ff6b6b',
                    width: 3,
                    lineDash: [10, 10]
                }),
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({
                        color: '#ff6b6b'
                    }),
                    stroke: new ol.style.Stroke({
                        color: 'white',
                        width: 2
                    })
                })
            })
        });
        
        // 添加双击结束绘制的逻辑
        let dblClickListener = function(event) {
            if (AppState.measureMode === 'area' && measureDrawInteraction) {
                // 检查是否至少有3个顶点
                const sketchFeature = measureDrawInteraction.sketchFeature_;
                if (sketchFeature && sketchFeature.getGeometry()) {
                    const geometry = sketchFeature.getGeometry();
                    const coordinates = geometry.getCoordinates()[0];
                    // 多边形是闭合的，所以需要至少4个点（3个顶点+1个闭合点）
                    if (coordinates.length >= 4) {
                        event.preventDefault();
                        event.stopPropagation();
                        measureDrawInteraction.finishDrawing();
                    }
                }
            }
        };
        
        // 在绘制开始时添加双击监听
        measureDrawInteraction.on('drawstart', function() {
            map.on('dblclick', dblClickListener);
        });
        
        // 在绘制结束时移除双击监听
        measureDrawInteraction.on(['drawend', 'drawabort'], function() {
            map.un('dblclick', dblClickListener);
        });
        
        let sketch;
        let listener;
        
        measureDrawInteraction.on('drawstart', function(evt) {
            sketch = evt.feature;
            let tooltipCoord = evt.coordinate;
            
            listener = sketch.getGeometry().on('change', function(evt) {
                const geom = evt.target;
                let output = formatMeasureResult(geom);
                tooltipCoord = geom.getInteriorPoint().getCoordinates();
                
                measureTooltipElement.innerHTML = output;
                AppState.measureTooltip.setPosition(tooltipCoord);
                measureTooltipElement.style.display = 'block';
            });
        });
        
        measureDrawInteraction.on('drawend', function(evt) {
            measureTooltipElement.className = 'measure-tooltip measure-tooltip-static';
            AppState.measureTooltip.setOffset([0, -7]);
            sketch = null;
            measureTooltipElement = null;
            ol.Observable.unByKey(listener);
            
            // 保存测量要素
            AppState.measureFeatures.push(evt.feature);
            
            // 重新创建提示框以便下一次测量
            createMeasureTooltip();
            
            showMessage('测面完成: ' + formatMeasureResult(evt.feature.getGeometry()), 'success');
        });
        
        // 鼠标移动提示
        map.on('pointermove', handleMeasurePointerMove);
        
        map.addInteraction(measureDrawInteraction);
        
        updateToolbarButtons();
        updateStatus();
        
        showMessage('测面模式：点击开始测量，双击结束', 'info');
    }
    
    // 鼠标移动处理
    function handleMeasurePointerMove(evt) {
        if (evt.dragging) {
            return;
        }
        
        if (AppState.measureHelpTooltip) {
            let helpMsg = '点击开始测量';
            if (measureDrawInteraction) {
                helpMsg = '点击继续绘制，双击结束测量';
            }
            measureHelpTooltipElement.innerHTML = helpMsg;
            AppState.measureHelpTooltip.setPosition(evt.coordinate);
        }
    }
    
    // 停止测量
    function stopMeasure() {
        if (measureDrawInteraction) {
            map.removeInteraction(measureDrawInteraction);
            measureDrawInteraction = null;
        }
        
        // 移除鼠标移动监听
        map.un('pointermove', handleMeasurePointerMove);
        
        // 移除提示框
        if (AppState.measureTooltip) {
            map.removeOverlay(AppState.measureTooltip);
            AppState.measureTooltip = null;
        }
        if (AppState.measureHelpTooltip) {
            map.removeOverlay(AppState.measureHelpTooltip);
            AppState.measureHelpTooltip = null;
        }
        
        if (measureTooltipElement) {
            measureTooltipElement.parentNode.removeChild(measureTooltipElement);
            measureTooltipElement = null;
        }
        if (measureHelpTooltipElement) {
            measureHelpTooltipElement.parentNode.removeChild(measureHelpTooltipElement);
            measureHelpTooltipElement = null;
        }
        
        AppState.measureMode = null;
        
        updateToolbarButtons();
        updateStatus();
    }
    
    // 清除所有测量结果
    function clearMeasureResults() {
        if (measureSource) {
            measureSource.clear();
        }
        AppState.measureFeatures = [];
        
        // 清除所有静态提示框
        const staticTooltips = document.querySelectorAll('.measure-tooltip-static');
        staticTooltips.forEach(function(tooltip) {
            tooltip.parentNode.removeChild(tooltip);
        });
        
        showMessage('已清除所有测量结果', 'info');
    }

    // ========== 地图控制 ==========
    function zoomIn() {
        if (map) {
            const view = map.getView();
            view.animate({
                zoom: view.getZoom() + 1,
                duration: 300
            });
        }
    }
    
    function zoomOut() {
        if (map) {
            const view = map.getView();
            view.animate({
                zoom: view.getZoom() - 1,
                duration: 300
            });
        }
    }
    
    function resetView() {
        if (map) {
            map.getView().animate({
                center: ol.proj.fromLonLat(CONFIG.INITIAL_CENTER),
                zoom: CONFIG.INITIAL_ZOOM,
                duration: 1000
            });
            showMessage('视图已重置', 'info');
        }
    }
    
    // ========== 底图图层控制 ==========
    
    // 切换影像图层显示/隐藏
    function toggleImageLayer() {
        if (!window.mapLayers) return;
        
        const imgLayer = window.mapLayers.imgLayer;
        const ciaLayer = window.mapLayers.ciaLayer;
        const vecLayer = window.mapLayers.vecLayer;
        const cvaLayer = window.mapLayers.cvaLayer;
        
        const isImgVisible = imgLayer.getVisible();
        
        if (isImgVisible) {
            // 切换到矢量底图
            imgLayer.setVisible(false);
            ciaLayer.setVisible(false);
            vecLayer.setVisible(true);
            cvaLayer.setVisible(true);
            showMessage('已切换到矢量底图', 'info');
        } else {
            // 切换到影像底图
            imgLayer.setVisible(true);
            ciaLayer.setVisible(true);
            vecLayer.setVisible(false);
            cvaLayer.setVisible(false);
            showMessage('已切换到影像底图', 'success');
        }
        
        updateLayerToggleButton();
    }
    
    // 更新图层切换按钮状态
    function updateLayerToggleButton() {
        const $btn = $('#toggleImageLayer');
        if (!window.mapLayers) return;
        
        const isImgVisible = window.mapLayers.imgLayer.getVisible();
        
        if (isImgVisible) {
            $btn.html('<i class="fas fa-satellite"></i>');
            $btn.attr('title', '切换到矢量底图');
            $btn.addClass('active');
        } else {
            $btn.html('<i class="fas fa-map"></i>');
            $btn.attr('title', '切换到影像底图');
            $btn.removeClass('active');
        }
    }
    
    // 设置影像图层透明度
    function setImageLayerOpacity(opacity) {
        if (!window.mapLayers) return;
        
        const imgLayer = window.mapLayers.imgLayer;
        const ciaLayer = window.mapLayers.ciaLayer;
        
        // 设置影像图层透明度
        imgLayer.setOpacity(opacity);
        // 注记图层保持较高透明度，确保文字清晰
        ciaLayer.setOpacity(Math.min(1.0, opacity + 0.2));
        
        // 更新滑块显示值
        $('#opacityValue').text(Math.round(opacity * 100) + '%');
        
        console.log(`影像图层透明度设置为: ${Math.round(opacity * 100)}%`);
    }
    
    // 显示/隐藏透明度控制面板
    function toggleOpacityControl() {
        const $panel = $('#opacityControlPanel');
        $panel.toggleClass('show');
    }
    
    // ========== 加载示例学区数据 ==========
    function loadSampleSchoolZone() {
        // 火炬学校教育集团火炬校区学区数据（基于天地图精确坐标）
        const sampleData = {
            "type": "FeatureCollection",
            "name": "火炬校区学区范围",
            "description": "基于天地图API搜索的精确坐标生成",
            "data_source": "天地图 - Key: f14e4bb40aa997803b046bcfbbd7aaa4",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "name": "火炬学校教育集团火炬校区",
                        "description": "河东大道以南，双拥路以东、高新路以北、火炬中路以东、晓塘路以北、芙蓉大道以西，以及长塘村、云盘村、云峰村、邓桥村、茶园村5个村房户一致原住村民子弟",
                        "school": "火炬学校教育集团火炬校区",
                        "boundary_description": {
                            "south": "河东大道 (lat: 27.85)",
                            "east_south": "双拥路 (lon: 112.94)",
                            "east_north": "火炬中路 (lon: 112.95)",
                            "north": "高新路/晓塘路 (lat: 27.82-27.85)",
                            "west": "芙蓉大道 (lon: 112.90)"
                        },
                        "villages": ["长塘村", "云盘村", "云峰村", "邓桥村", "茶园村"]
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [112.90, 27.85],
                            [112.91, 27.855],
                            [112.92, 27.858],
                            [112.93, 27.86],
                            [112.94, 27.862],
                            [112.945, 27.87],
                            [112.948, 27.88],
                            [112.95, 27.89],
                            [112.952, 27.895],
                            [112.94, 27.898],
                            [112.93, 27.895],
                            [112.92, 27.89],
                            [112.91, 27.885],
                            [112.905, 27.88],
                            [112.90, 27.85]
                        ]]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "长塘村",
                        "type": "village",
                        "tianditu_coords": "lon: 112.95, lat: 27.84"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.95, 27.84]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "云盘村",
                        "type": "village",
                        "tianditu_coords": "lon: 112.95, lat: 27.85"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.95, 27.85]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "云峰村",
                        "type": "village",
                        "tianditu_coords": "lon: 112.94, lat: 27.84"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.94, 27.84]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "邓桥村",
                        "type": "village",
                        "tianditu_coords": "lon: 112.96, lat: 27.82"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.96, 27.82]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "茶园村",
                        "type": "village",
                        "tianditu_coords": "lon: 112.95, lat: 27.84"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.95, 27.84]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "芙蓉大道（西界）",
                        "type": "road",
                        "boundary": "西界",
                        "tianditu_coords": "lon: 113.01, lat: 27.87"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.90, 27.875]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "河东大道（南界）",
                        "type": "road",
                        "boundary": "南界",
                        "tianditu_coords": "lon: 112.93, lat: 27.85"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.93, 27.85]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "双拥路（东界南段）",
                        "type": "road",
                        "boundary": "东界南段",
                        "tianditu_coords": "lon: 112.94, lat: 27.84"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.94, 27.865]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "火炬中路（东界北段）",
                        "type": "road",
                        "boundary": "东界北段",
                        "tianditu_coords": "lon: 112.95, lat: 27.84"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.95, 27.885]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "高新路（北界东段）",
                        "type": "road",
                        "boundary": "北界东段",
                        "tianditu_coords": "lon: 112.93, lat: 27.85"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.935, 27.895]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {
                        "name": "晓塘路（北界中段）",
                        "type": "road",
                        "boundary": "北界中段",
                        "tianditu_coords": "lon: 112.93, lat: 27.82"
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [112.925, 27.89]
                    }
                }
            ]
        };
        
        // 检查是否已存在该文件
        const existingFile = AppState.jsonFiles.find(f => f.name === '火炬校区学区范围.geojson');
        if (existingFile) {
            showMessage('示例学区数据已存在，请勿重复加载', 'warning');
            selectJSONFile(existingFile.id);
            return;
        }
        
        // 解析并加载数据
        const format = new ol.format.GeoJSON();
        const importedFeatures = [];
        
        // 创建新的JSON文件记录
        const fileId = 'file_' + Date.now();
        const jsonFile = {
            id: fileId,
            name: '火炬校区学区范围.geojson',
            importTime: new Date().toLocaleString(),
            featureCount: 0
        };
        
        // 解析GeoJSON要素
        sampleData.features.forEach(function(featureData, index) {
            try {
                const feature = format.readFeature(featureData, {
                    featureProjection: 'EPSG:3857',
                    dataProjection: 'EPSG:4326'
                });
                
                // 设置唯一ID
                const featureId = 'sample_' + Date.now() + '_' + index;
                feature.setId(featureId);
                
                // 标记该要素属于新导入的文件
                feature.set('sourceFileId', fileId);
                feature.set('sourceFileName', jsonFile.name);
                
                // 读取并设置多边形名称
                if (featureData.properties && featureData.properties.name) {
                    const featureName = featureData.properties.name;
                    feature.set('name', featureName);
                    AppState.polygonNames[featureId] = featureName;
                }
                
                vectorSource.addFeature(feature);
                importedFeatures.push(feature);
                
            } catch (featureError) {
                console.warn(`跳过无效要素 ${index}:`, featureError.message);
            }
        });
        
        // 更新文件记录
        jsonFile.featureCount = importedFeatures.length;
        AppState.jsonFiles.push(jsonFile);
        AppState.jsonFeatureMap.set(fileId, importedFeatures);
        
        // 更新文件列表并选中新导入的文件
        updateJSONFileList();
        selectJSONFile(fileId);
        
        // 居中显示数据
        if (importedFeatures.length > 0) {
            const extent = ol.extent.createEmpty();
            importedFeatures.forEach(feature => {
                const geometry = feature.getGeometry();
                if (geometry) {
                    ol.extent.extend(extent, geometry.getExtent());
                }
            });
            
            if (extent && extent[0] !== Infinity) {
                map.getView().fit(extent, {
                    padding: [50, 50, 50, 50],
                    maxZoom: 14,
                    duration: 1000
                });
            }
        }
        
        showMessage(`✅ 已加载示例学区数据：火炬校区学区范围，共 ${importedFeatures.length} 个要素`, 'success');
        console.log('示例学区数据加载完成:', jsonFile.name);
    }
    
    // ========== 事件绑定 ==========
    function bindEvents() {
        console.log('绑定事件...');
        
        // JSON文件导入
        $('#importGeoJSON').on('click', importGeoJSON);
        $('#geoJSONFile').on('change', handleGeoJSONImport);
        
        // 文件夹导入
        $('#importFolder').on('click', importGeoJSONFolder);
        $('#geoJSONFolder').on('change', handleGeoJSONFolderImport);
        
        // 文件搜索
        $('#fileSearchInput').on('input', handleFileSearch);
        $('#clearFileSearch').on('click', clearFileSearch);
        
        // 全部隐藏/显示
        $('#toggleAllFilesVisibility').on('click', toggleAllFilesVisibility);
        
        // 辅助要素文件选择事件（由侧边栏导入按钮触发）
        $('#assistGeoJSONFile').on('change', function(e) {
            console.log('辅助要素文件已选择', e.target.files);
            handleAssistGeoJSONImport(e);
        });
        
        // 侧边栏收缩按钮
        $('#sidebarToggle').on('click', toggleSidebar);
        
        // 右侧边栏收缩按钮
        $('#rightSidebarToggle').on('click', toggleRightSidebar);
        
        // 辅助元素文件管理事件
        $('#importAssistFile').on('click', importAssistFile);
        $('#importAssistFolder').on('click', importAssistFolder);
        $('#assistGeoJSONFolder').on('change', handleAssistGeoJSONFolderImport);
        $('#assistFileSearchInput').on('input', handleAssistFileSearch);
        $('#clearAssistFileSearch').on('click', clearAssistFileSearch);
        $('#toggleAllAssistFilesVisibility').on('click', toggleAllAssistFilesVisibility);
        

        
        // 绘制工具
        $('#drawPolygon').on('click', function() {
            if (AppState.currentMode === 'drawPolygon') {
                stopDrawPolygon();
            } else {
                startDrawPolygon();
            }
        });
        
        // 辅助绘制工具
        $('#drawAssistLine').on('click', function() {
            if (AppState.currentMode === 'drawLine') {
                stopDrawLine();
            } else {
                startDrawLine();
            }
        });
        
        $('#drawAssistPolygon').on('click', function() {
            if (AppState.currentMode === 'drawAssistPolygon') {
                stopDrawAssistPolygon();
            } else {
                startDrawAssistPolygon();
            }
        });
        
        $('#drawAssistText').on('click', function() {
            if (AppState.currentMode === 'drawAssistText') {
                // 取消文字绘制模式
                AppState.currentMode = 'browse';
                AppState.isDrawing = false;
                updateToolbarButtons();
                updateStatus();
                showMessage('已取消文字标注', 'info');
            } else {
                startDrawAssistText();
            }
        });
        
        // 辅助点绘制工具
        $('#drawAssistPoint').on('click', function() {
            if (AppState.currentMode === 'drawAssistPoint') {
                // 取消点绘制模式
                AppState.currentMode = 'browse';
                AppState.isDrawing = false;
                updateToolbarButtons();
                updateStatus();
                showMessage('已取消辅助点绘制', 'info');
            } else {
                startDrawAssistPoint();
            }
        });
        
        // 辅助要素管理
        $('#selectAssistFeature').on('click', toggleAssistSelectMode);
        $('#editAssistPolygon').on('click', toggleAssistPolygonEdit);
        $('#deleteAssistFeature').on('click', deleteSelectedAssistFeature);
        $('#clearAssistFeatures').on('click', clearAssistFeatures);
        $('#toggleAssistVisibility').on('click', toggleAssistFeaturesVisibility);
        
        // 编辑工具
        $('#selectPolygon').on('click', startSelectMode);
        $('#editPolygon').on('click', toggleEditPolygon);
        $('#deletePolygon').on('click', deleteSelectedPolygon);
        $('#deleteVertex').on('click', deleteSelectedVertex);
        
        // 测量工具
        $('#measureLength').on('click', function() {
            if (AppState.measureMode === 'length') {
                stopMeasure();
                showMessage('已退出测距模式', 'info');
            } else {
                startMeasureLength();
            }
        });
        $('#measureArea').on('click', function() {
            if (AppState.measureMode === 'area') {
                stopMeasure();
                showMessage('已退出测面模式', 'info');
            } else {
                startMeasureArea();
            }
        });
        $('#clearMeasure').on('click', clearMeasureResults);
        
        // 数据管理
        $('#exportGeoJSON').on('click', exportToGeoJSON);
        
        // 搜索功能
        $('#searchBtn').on('click', searchPlace);
        $('#searchInput').on('keypress', function(e) {
            if (e.which === 13) {
                searchPlace();
            }
        });
        $('#clearSearch').on('click', clearSearchResults);
        $('#closeSearchResults').on('click', function() {
            $('#searchResultsPanel').removeClass('show');
        });
        
        // 地图控制
        $('#zoomIn').on('click', zoomIn);
        $('#zoomOut').on('click', zoomOut);
        $('#resetView').on('click', resetView);
        
        // 底图图层切换和透明度控制
        $('#toggleImageLayer').on('click', toggleImageLayer);
        $('#toggleOpacityPanel').on('click', toggleOpacityControl);
        $('#layerOpacity').on('input', function() {
            const opacity = parseFloat($(this).val());
            setImageLayerOpacity(opacity);
        });
        
        // 点击其他地方关闭透明度面板
        $(document).on('click', function(e) {
            if (!$(e.target).closest('#toggleOpacityPanel, #opacityControlPanel').length) {
                $('#opacityControlPanel').removeClass('show');
            }
        });
        
        // ========== 天地图KEY管理事件 ==========
        // KEY管理器展开/收起
        $('#keyManagerToggle').on('click', function() {
            const $content = $('#keyManagerContent');
            const $arrow = $('#keyManagerArrow');
            if ($content.is(':visible')) {
                $content.slideUp(200);
                $arrow.removeClass('fa-chevron-up').addClass('fa-chevron-down');
            } else {
                $content.slideDown(200);
                $arrow.removeClass('fa-chevron-down').addClass('fa-chevron-up');
                updateKeyStatusDisplay();
            }
        });
        
        // 刷新KEY状态
        $('#keyStatusIndicator').on('click', function() {
            updateKeyStatusDisplay();
            showMessage('KEY状态已刷新', 'info');
        });
        
        // 添加新KEY
        $('#addKeyBtn').on('click', showAddKeyModal);
        
        // 查看/管理KEY
        $('#viewKeysBtn').on('click', showKeyManagerModal);
        
        // 重置KEY状态
        $('#resetKeyBtn').on('click', function() {
            if (confirm('确定要重置所有KEY的使用状态吗？这将清除所有失败标记和计数。')) {
                TiandituKeyManager.reset();
                updateKeyStatusDisplay();
                showMessage('KEY状态已重置', 'success');
            }
        });
        
        console.log('事件绑定完成');
    }
    
    // ========== KEY管理UI函数 ==========
    
    // 更新KEY状态显示
    function updateKeyStatusDisplay() {
        const status = TiandituKeyManager.getStatus();
        $('#currentKeyIndex').text(`${status.currentIndex + 1}/${status.totalKeys}`);
        
        const $indicator = $('#keyStatusIndicator');
        if (status.failedCount >= status.totalKeys - 1) {
            $indicator.removeClass('warning').addClass('error');
        } else if (status.failedCount > 0) {
            $indicator.removeClass('error').addClass('warning');
        } else {
            $indicator.removeClass('warning error');
        }
    }
    
    // 显示添加KEY弹窗
    function showAddKeyModal() {
        if ($('#addKeyModal').length > 0) {
            $('#addKeyModal').remove();
        }
        
        const modalHtml = `
            <div id="addKeyModal" class="modal-overlay">
                <div class="modal-content" style="max-width: 450px;">
                    <h3><i class="fas fa-key"></i> 添加天地图KEY</h3>
                    <p style="color:#666;margin-bottom:15px;font-size:13px;">
                        请输入新的天地图KEY（32位字符）<br>
                        <span style="color:#999;font-size:12px;">KEY可以从天地图开发者中心申请</span>
                    </p>
                    <input type="text" id="newKeyInput" placeholder="输入32位天地图KEY" maxlength="40" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:13px;">
                    <div class="modal-buttons">
                        <button id="confirmAddKey" class="modal-confirm">
                            <i class="fas fa-check"></i> 添加
                        </button>
                        <button id="cancelAddKey" class="modal-cancel">
                            <i class="fas fa-times"></i> 取消
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(modalHtml);
        $('#newKeyInput').focus();
        
        $('#confirmAddKey').off('click').on('click', function() {
            const newKey = $('#newKeyInput').val().trim();
            const result = TiandituKeyManager.addKey(newKey);
            
            if (result.success) {
                $('#addKeyModal').remove();
                updateKeyStatusDisplay();
                showMessage(result.message, 'success');
            } else {
                alert(result.message);
                $('#newKeyInput').focus();
            }
        });
        
        $('#cancelAddKey').off('click').on('click', function() {
            $('#addKeyModal').remove();
        });
        
        $('#newKeyInput').off('keypress').on('keypress', function(e) {
            if (e.which === 13) {
                $('#confirmAddKey').click();
            }
        });
        
        $('#addKeyModal').off('click').on('click', function(e) {
            if (e.target.id === 'addKeyModal') {
                $('#cancelAddKey').click();
            }
        });
    }
    
    // 显示KEY管理弹窗
    function showKeyManagerModal() {
        if ($('#keyManagerModal').length > 0) {
            $('#keyManagerModal').remove();
        }
        
        const status = TiandituKeyManager.getStatus();
        let keyListHtml = '';
        
        TiandituKeyManager.keys.forEach((key, index) => {
            const isCurrent = index === TiandituKeyManager.currentIndex;
            const isFailed = TiandituKeyManager.failedKeys.has(index);
            const usageCount = TiandituKeyManager.keyUsageCount[key] || 0;
            
            keyListHtml += `
                <div class="key-list-item ${isCurrent ? 'current' : ''} ${isFailed ? 'failed' : ''}">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-weight:600;color:#6c757d;min-width:25px;">${index + 1}.</span>
                        <span>${key.substring(0, 12)}...${key.substring(key.length - 4)}</span>
                        ${isCurrent ? '<span style="background:#2196f3;color:white;padding:2px 8px;border-radius:3px;font-size:11px;">当前</span>' : ''}
                        ${isFailed ? '<span style="background:#dc3545;color:white;padding:2px 8px;border-radius:3px;font-size:11px;">已用完</span>' : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:11px;color:#6c757d;">使用: ${usageCount}</span>
                        <div class="key-actions-btns">
                            ${!isCurrent ? `<button class="btn-delete-key" data-index="${index}" title="删除此KEY"><i class="fas fa-trash"></i></button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        
        const modalHtml = `
            <div id="keyManagerModal" class="modal-overlay">
                <div class="modal-content" style="max-width: 500px;max-height:80vh;overflow-y:auto;">
                    <h3><i class="fas fa-list"></i> 天地图KEY管理</h3>
                    <p style="color:#666;margin-bottom:15px;font-size:13px;">
                        共 ${status.totalKeys} 个KEY，当前使用第 ${status.currentIndex + 1} 个<br>
                        <span style="color:#28a745;">●</span> 正常 <span style="color:#ffc107;">●</span> 警告 <span style="color:#dc3545;">●</span> 已用完
                    </p>
                    <div style="max-height:300px;overflow-y:auto;margin-bottom:15px;">
                        ${keyListHtml}
                    </div>
                    <div class="modal-buttons">
                        <button id="closeKeyManager" class="modal-confirm" style="flex:1;">
                            <i class="fas fa-check"></i> 确定
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(modalHtml);
        
        // 删除KEY事件
        $('.btn-delete-key').on('click', function() {
            const index = parseInt($(this).data('index'));
            if (confirm(`确定要删除第 ${index + 1} 个KEY吗？`)) {
                const result = TiandituKeyManager.removeKey(index);
                if (result.success) {
                    showMessage(result.message, 'success');
                    $('#keyManagerModal').remove();
                    showKeyManagerModal(); // 重新打开弹窗
                    updateKeyStatusDisplay();
                } else {
                    alert(result.message);
                }
            }
        });
        
        $('#closeKeyManager').off('click').on('click', function() {
            $('#keyManagerModal').remove();
        });
        
        $('#keyManagerModal').off('click').on('click', function(e) {
            if (e.target.id === 'keyManagerModal') {
                $('#closeKeyManager').click();
            }
        });
    }
    
    // ========== 多边形名称管理 ==========
    function promptPolygonName(feature) {
        if ($('#polygonNameModal').length > 0) {
            $('#polygonNameModal').remove();
        }
        
        const modalHtml = `
            <div id="polygonNameModal" class="modal-overlay">
                <div class="modal-content">
                    <h3><i class="fas fa-tag"></i> 为多边形命名</h3>
                    <p style="color:#666;margin-bottom:15px;">请输入这个多边形的名称</p>
                    <input type="text" id="polygonNameInput" placeholder="输入多边形名称" autofocus>
                    <div class="modal-buttons">
                        <button id="confirmPolygonName" class="modal-confirm">
                            <i class="fas fa-check"></i> 确认
                        </button>
                        <button id="cancelPolygonName" class="modal-cancel">
                            <i class="fas fa-times"></i> 取消
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(modalHtml);
        
        setTimeout(() => {
            $('#polygonNameInput').focus();
        }, 100);
        
        $('#confirmPolygonName').off('click').on('click', function() {
            const name = $('#polygonNameInput').val().trim();
            if (name) {
                $('#polygonNameModal').remove();
                setPolygonName(feature, name);
                showMessage(`多边形已命名为: ${name}`, 'success');
            } else {
                alert('请输入多边形名称');
                $('#polygonNameInput').focus();
            }
        });
        
        $('#cancelPolygonName').off('click').on('click', function() {
            $('#polygonNameModal').remove();
            const defaultName = `多边形_${Date.now()}`;
            setPolygonName(feature, defaultName);
        });
        
        $('#polygonNameInput').off('keypress').on('keypress', function(e) {
            if (e.which === 13) {
                $('#confirmPolygonName').click();
            }
        });
        
        $('#polygonNameModal').off('click').on('click', function(e) {
            if (e.target.id === 'polygonNameModal') {
                $('#cancelPolygonName').click();
            }
        });
    }
    
    function setPolygonName(feature, name) {
        const featureId = feature.getId();
        feature.set('name', name);
        AppState.polygonNames[featureId] = name;
        feature.changed();
    }
    
    // 生成默认文件名
    function generateDefaultFileName() {
        const date = new Date();
        const timestamp = date.toISOString().slice(0, 19).replace(/:/g, '-');
        return `新建学区_${timestamp}.geojson`;
    }
    
    // 创建新的JSON文件
    function createNewJSONFile(fileName) {
        const fileId = 'file_' + Date.now() + '_' + AppState.nextFileId++;
        const jsonFile = {
            id: fileId,
            name: fileName || generateDefaultFileName(),
            importTime: new Date().toLocaleString(),
            featureCount: 0,
            isDefault: !fileName // 标记是否为默认创建的文件
        };
        
        AppState.jsonFiles.push(jsonFile);
        AppState.jsonFeatureMap.set(fileId, []);
        
        updateJSONFileList();
        updateToggleAllButton();
        
        // 自动选中新创建的文件
        selectJSONFile(fileId);
        
        console.log(`创建新学区文件: ${jsonFile.name}, ID: ${fileId}`);
        showMessage(`已创建默认学区: ${jsonFile.name}`, 'success');
        
        return jsonFile;
    }
    
    // ========== 应用初始化 ==========
    function initApp() {
        console.log('初始化GIS应用...');
        
        if (typeof ol === 'undefined') {
            showMessage('OpenLayers未加载', 'error');
            return;
        }
        
        if (typeof $ === 'undefined') {
            showMessage('jQuery未加载', 'error');
            return;
        }
        
        initMap();
        bindEvents();
        
        // 创建默认的JSON文件（学区）
        createNewJSONFile(generateDefaultFileName());
        
        // 创建默认的辅助元素图层
        createDefaultAssistLayer();
        
        // 初始化图层控制按钮状态
        updateLayerToggleButton();
        
        // 初始化KEY状态显示
        updateKeyStatusDisplay();
        
        updateStatus();
        
        console.log('GIS应用初始化完成');
        showMessage('GIS应用已就绪！已创建默认文件', 'success');
        
        // 检查是否需要显示向导（首次访问）
        initTourGuide();
    }
    
    // 启动应用
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
    
    // ========== 用户向导功能 ==========
    
    // 向导配置
    const TOUR_STEPS = [
        {
            selector: '#importGeoJSON',
            title: '导入学区文件',
            content: '请点击这里，导入您的学区文件，比如<span style="color:#e74c3c;font-weight:600;">滴水湖学校教育集团南天校区.geojson</span>',
            position: 'bottom'
        },
        {
            selector: '#selectPolygon, #editPolygon, #deletePolygon, #deleteVertex',
            title: '学区图形编辑',
            content: '这里可以选中、编辑您的学区图形，您可以拖拽顶点、按<span style="color:#e74c3c;font-weight:600;">DELETE</span>删除顶点',
            position: 'bottom',
            groupHighlight: true
        },
        {
            selector: '#exportGeoJSON',
            title: '导出修改后的学区',
            content: '这里可以保存您修改后的学区文件。导出后建议您再导入进来确认下~',
            position: 'bottom'
        },
        {
            selector: '#toggleAllFilesVisibility',
            title: '隐藏/显示学区',
            content: '这里可以隐藏/显示您的学区文件，方便查看底图',
            position: 'right'
        },
        {
            selector: '#toggleImageLayer',
            title: '切换影像底图',
            content: '这里可以切换至高清影像，查看更清晰的地图细节',
            position: 'left'
        },
        {
            selector: '#searchInput',
            title: '地名搜索',
            content: '这里可以搜索地址，快速定位到您需要的地点',
            position: 'bottom'
        }
    ];
    
    let tourCurrentStep = 0;
    let tourActive = false;
    let highlightedElements = [];
    
    // 初始化向导
    function initTourGuide() {
        // 检查是否已经看过向导
        const hasSeenTour = localStorage.getItem('gisAppTourCompleted');
        
        // 绑定重新查看向导按钮
        $('#tourStartBtn').on('click', function() {
            startTour();
        });
        
        // 绑定跳过按钮
        $('#tourSkipBtn').on('click', function() {
            endTour();
            localStorage.setItem('gisAppTourCompleted', 'true');
        });
        
        // 绑定下一步按钮
        $('#tourNextBtn').on('click', function() {
            nextTourStep();
        });
        
        // 点击遮罩层也可以跳过
        $('#tourOverlay').on('click', function() {
            endTour();
            localStorage.setItem('gisAppTourCompleted', 'true');
        });
        
        // 首次访问自动显示向导
        if (!hasSeenTour) {
            // 延迟启动，确保页面完全渲染
            setTimeout(function() {
                startTour();
            }, 1000);
        }
    }
    
    // 开始向导
    function startTour() {
        tourCurrentStep = 0;
        tourActive = true;
        $('#tourOverlay').addClass('active');
        $('#tourStartBtn').addClass('hidden');
        $('#tourTotalSteps').text(TOUR_STEPS.length);
        showTourStep();
    }
    
    // 结束向导
    function endTour() {
        tourActive = false;
        $('#tourOverlay').removeClass('active');
        $('#tourTooltip').removeClass('active');
        $('#tourStartBtn').removeClass('hidden');
        clearHighlights();
    }
    
    // 显示当前步骤
    function showTourStep() {
        if (tourCurrentStep >= TOUR_STEPS.length) {
            // 向导完成
            endTour();
            localStorage.setItem('gisAppTourCompleted', 'true');
            showMessage('向导完成！您可以点击右下角问号按钮重新查看', 'success');
            return;
        }
        
        const step = TOUR_STEPS[tourCurrentStep];
        const $elements = $(step.selector);
        
        if ($elements.length === 0) {
            // 元素未找到，跳过这一步
            console.warn('向导元素未找到:', step.selector);
            tourCurrentStep++;
            showTourStep();
            return;
        }
        
        // 清除之前的高亮
        clearHighlights();
        
        // 高亮当前元素
        $elements.each(function() {
            $(this).addClass('tour-highlight');
            highlightedElements.push(this);
        });
        
        // 更新提示内容
        $('#tourContent').html(step.content);
        $('.tour-tooltip-title').text(step.title);
        $('#tourCurrentStep').text(tourCurrentStep + 1);
        
        // 更新按钮文字
        if (tourCurrentStep === TOUR_STEPS.length - 1) {
            $('#tourNextBtn').text('完成').removeClass('tour-btn-next').addClass('tour-btn-finish');
        } else {
            $('#tourNextBtn').text('下一步').removeClass('tour-btn-finish').addClass('tour-btn-next');
        }
        
        // 定位提示框
        positionTooltip($elements.first(), step.position);
        
        // 显示提示框
        $('#tourTooltip').addClass('active');
        
        // 滚动到元素（如果需要）
        scrollToElement($elements.first());
    }
    
    // 下一步
    function nextTourStep() {
        tourCurrentStep++;
        showTourStep();
    }
    
    // 清除高亮
    function clearHighlights() {
        highlightedElements.forEach(function(el) {
            $(el).removeClass('tour-highlight');
        });
        highlightedElements = [];
    }
    
    // 定位提示框
    function positionTooltip($target, position) {
        const $tooltip = $('#tourTooltip');
        const targetRect = $target[0].getBoundingClientRect();
        const tooltipRect = $tooltip[0].getBoundingClientRect();
        const margin = 15;
        
        let top, left;
        
        // 根据位置计算坐标
        switch (position) {
            case 'bottom':
                top = targetRect.bottom + margin;
                left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
                $tooltip.removeClass('arrow-top arrow-left arrow-right').addClass('arrow-bottom');
                break;
            case 'top':
                top = targetRect.top - tooltipRect.height - margin;
                left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
                $tooltip.removeClass('arrow-bottom arrow-left arrow-right').addClass('arrow-top');
                break;
            case 'left':
                top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
                left = targetRect.left - tooltipRect.width - margin;
                $tooltip.removeClass('arrow-top arrow-bottom arrow-right').addClass('arrow-left');
                break;
            case 'right':
                top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
                left = targetRect.right + margin;
                $tooltip.removeClass('arrow-top arrow-bottom arrow-left').addClass('arrow-right');
                break;
            default:
                top = targetRect.bottom + margin;
                left = targetRect.left;
        }
        
        // 边界检查，确保提示框在视口内
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // 水平边界检查
        if (left < 10) {
            left = 10;
        } else if (left + tooltipRect.width > viewportWidth - 10) {
            left = viewportWidth - tooltipRect.width - 10;
        }
        
        // 垂直边界检查
        if (top < 10) {
            // 如果上方空间不足，改为显示在下方
            top = targetRect.bottom + margin;
            $tooltip.removeClass('arrow-bottom arrow-left arrow-right').addClass('arrow-top');
        } else if (top + tooltipRect.height > viewportHeight - 10) {
            // 如果下方空间不足，改为显示在上方
            top = targetRect.top - tooltipRect.height - margin;
            $tooltip.removeClass('arrow-top arrow-left arrow-right').addClass('arrow-bottom');
        }
        
        $tooltip.css({
            top: top + 'px',
            left: left + 'px'
        });
    }
    
    // 滚动到元素
    function scrollToElement($element) {
        const elementRect = $element[0].getBoundingClientRect();
        const isInViewport = elementRect.top >= 0 && 
                             elementRect.bottom <= window.innerHeight &&
                             elementRect.left >= 0 && 
                             elementRect.right <= window.innerWidth;
        
        if (!isInViewport) {
            // 如果侧边栏是折叠状态，先展开
            if ($element.closest('.sidebar.collapsed').length > 0) {
                const sidebarId = $element.closest('.sidebar').attr('id');
                if (sidebarId === 'sidebar') {
                    $('#sidebarToggle').click();
                } else if (sidebarId === 'rightSidebar') {
                    $('#rightSidebarToggle').click();
                }
            }
            
            $element[0].scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'center'
            });
        }
    }
    
    // 窗口大小改变时重新定位
    $(window).on('resize', function() {
        if (tourActive && tourCurrentStep < TOUR_STEPS.length) {
            const step = TOUR_STEPS[tourCurrentStep];
            const $element = $(step.selector).first();
            if ($element.length > 0) {
                positionTooltip($element, step.position);
            }
        }
    });
    
})();
