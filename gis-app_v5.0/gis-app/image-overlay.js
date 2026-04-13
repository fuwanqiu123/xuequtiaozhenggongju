/**
 * GIS-APP 图片配准叠加模块
 * 用于将社区平面图等图片精确叠加到地图上作为参考
 * 支持：滑块调整、鼠标拖拽（按住Shift）
 */
(function() {
    'use strict';
    
    // 图片叠加管理器
    window.ImageOverlayManager = {
        overlays: new Map(),
        activeOverlayId: null,
        map: null,
        panel: null,
        
        // 拖拽状态
        dragState: {
            isDragging: false,
            startPixel: null,
            startParams: null
        },
        
        // 初始化
        init: function(mapInstance) {
            this.map = mapInstance;
            this.createPanel();
            this.bindEvents();
            this.initMouseDrag();
            console.log('[图片配准] 管理器已初始化（支持滑块调整和鼠标拖拽）');
        },
        
        // 创建控制面板
        createPanel: function() {
            const panel = document.createElement('div');
            panel.id = 'imageOverlayPanel';
            panel.className = 'image-overlay-panel';
            panel.innerHTML = `
                <div class="panel-header">
                    <span><i class="fas fa-image"></i> 图片配准工具</span>
                    <button id="closeImagePanel" class="btn-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="panel-body">
                    <div class="image-list-section">
                        <div class="section-title">
                            <span>已导入图片</span>
                            <button id="importImageBtn" class="btn-small">
                                <i class="fas fa-plus"></i> 导入
                            </button>
                        </div>
                        <div id="imageOverlayList" class="image-list">
                            <div class="no-data">暂无图片，请点击"导入"添加社区平面图</div>
                        </div>
                    </div>
                    
                    <div class="adjust-section" id="adjustSection" style="display:none;">
                        <div class="section-title">位置调整</div>
                        
                        <div class="control-group">
                            <label>透明度: <span id="opacityValue">70%</span></label>
                            <input type="range" id="opacitySlider" min="0.1" max="1" step="0.05" value="0.7" tabindex="1">
                        </div>
                        
                        <div class="control-group">
                            <label>缩放比例: <span id="scaleValue">1.0x</span></label>
                            <input type="range" id="scaleSlider" min="0.1" max="5" step="0.02" value="1" tabindex="2">
                        </div>
                        
                        <div class="control-group">
                            <label>旋转角度: <span id="rotationValue">0°</span></label>
                            <input type="range" id="rotationSlider" min="-180" max="180" step="1" value="0" tabindex="3">
                        </div>
                        
                        <div class="control-group">
                            <label>左右偏移: <span id="xOffsetValue">0m</span></label>
                            <input type="range" id="xOffsetSlider" min="-5000" max="5000" step="5" value="0" tabindex="4">
                        </div>
                        
                        <div class="control-group">
                            <label>上下偏移: <span id="yOffsetValue">0m</span></label>
                            <input type="range" id="yOffsetSlider" min="-5000" max="5000" step="5" value="0" tabindex="5">
                        </div>
                        
                        <div class="drag-mode-hint" id="dragModeHint">
                            <i class="fas fa-hand-paper"></i> 
                            <strong>鼠标拖拽模式：</strong>按住 <kbd>Shift</kbd> 键 + 拖动图片可快速调整位置
                        </div>
                        
                        <div class="control-buttons">
                            <button id="resetAdjustBtn" class="btn-secondary">
                                <i class="fas fa-undo"></i> 重置
                            </button>
                            <button id="lockImageBtn" class="btn-primary">
                                <i class="fas fa-lock"></i> 锁定位置
                            </button>
                        </div>
                        
                        <div class="tip-box">
                            <i class="fas fa-lightbulb"></i> 
                            <small>建议：先调透明度至50%，用鼠标拖拽大致对齐，再用滑块精确微调</small>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(panel);
            this.panel = panel;
        },
        
        // 绑定事件
        bindEvents: function() {
            const self = this;
            
            // 关闭面板
            document.getElementById('closeImagePanel').addEventListener('click', function() {
                self.hide();
            });
            
            // 导入图片
            document.getElementById('importImageBtn').addEventListener('click', function() {
                self.openImportDialog();
            });
            
            // 调整参数变化
            const sliders = [
                { id: 'opacitySlider', name: 'opacity', display: 'opacityValue', unit: '%', scale: 100 },
                { id: 'scaleSlider', name: 'scale', display: 'scaleValue', unit: 'x', scale: 1 },
                { id: 'rotationSlider', name: 'rotation', display: 'rotationValue', unit: '°', scale: 1 },
                { id: 'xOffsetSlider', name: 'x', display: 'xOffsetValue', unit: 'm', scale: 1 },
                { id: 'yOffsetSlider', name: 'y', display: 'yOffsetValue', unit: 'm', scale: 1 }
            ];
            
            sliders.forEach(function(s) {
                const slider = document.getElementById(s.id);
                if (slider) {
                    slider.addEventListener('input', function(e) {
                        const value = parseFloat(e.target.value);
                        document.getElementById(s.display).textContent = 
                            (value * s.scale).toFixed(s.name === 'scale' ? 1 : 0) + s.unit;
                        self.applyAdjustments();
                    });
                }
            });
            
            // 重置按钮
            document.getElementById('resetAdjustBtn').addEventListener('click', function() {
                self.resetParams();
            });
            
            // 锁定按钮
            document.getElementById('lockImageBtn').addEventListener('click', function() {
                self.toggleLock();
            });
        },
        
        // 初始化鼠标拖拽
        initMouseDrag: function() {
            const self = this;
            
            if (!this.map) return;
            
            // 监听鼠标按下
            this.map.on('pointerdown', function(e) {
                if (!self.activeOverlayId) return;
                if (!e.originalEvent.shiftKey) return; // 需要按住 Shift
                
                const overlay = self.overlays.get(self.activeOverlayId);
                if (!overlay) return;
                
                // 检查是否点击在图片范围内
                const extent = overlay.extent;
                const coord = e.coordinate;
                
                if (coord[0] >= extent[0] && coord[0] <= extent[2] &&
                    coord[1] >= extent[1] && coord[1] <= extent[3]) {
                    
                    self.dragState.isDragging = true;
                    self.dragState.startPixel = e.pixel;
                    self.dragState.startParams = { ...overlay.params };
                    
                    // 显示拖拽提示
                    self.showDragHint(true);
                    
                    e.originalEvent.preventDefault();
                }
            });
            
            // 监听鼠标移动
            this.map.on('pointermove', function(e) {
                if (!self.dragState.isDragging) {
                    // 更新鼠标样式提示
                    if (e.originalEvent.shiftKey && self.activeOverlayId) {
                        const overlay = self.overlays.get(self.activeOverlayId);
                        if (overlay) {
                            const extent = overlay.extent;
                            const coord = e.coordinate;
                            const isOverImage = coord[0] >= extent[0] && coord[0] <= extent[2] &&
                                               coord[1] >= extent[1] && coord[1] <= extent[3];
                            self.setMapCursor(isOverImage ? 'move' : '');
                        }
                    } else {
                        self.setMapCursor('');
                    }
                    return;
                }
                
                // 计算像素差值转换为地图偏移
                const currentPixel = e.pixel;
                const dx = currentPixel[0] - self.dragState.startPixel[0];
                const dy = currentPixel[1] - self.dragState.startPixel[1];
                
                // 将像素差转换为地图单位（米）
                const resolution = self.map.getView().getResolution();
                const mapDx = dx * resolution;
                const mapDy = -dy * resolution; // Y轴翻转
                
                // 更新参数
                const newX = self.dragState.startParams.x + mapDx;
                const newY = self.dragState.startParams.y + mapDy;
                
                // 更新滑块和应用
                document.getElementById('xOffsetSlider').value = newX;
                document.getElementById('yOffsetSlider').value = newY;
                document.getElementById('xOffsetValue').textContent = Math.round(newX) + 'm';
                document.getElementById('yOffsetValue').textContent = Math.round(newY) + 'm';
                
                self.applyAdjustments();
                
                // 更新起始点（连续拖拽）
                self.dragState.startPixel = currentPixel;
                self.dragState.startParams.x = newX;
                self.dragState.startParams.y = newY;
            });
            
            // 监听鼠标释放
            this.map.on('pointerup', function(e) {
                if (self.dragState.isDragging) {
                    self.dragState.isDragging = false;
                    self.showDragHint(false);
                    self.showMessage('位置已调整，可使用方向键继续微调', 'success');
                }
            });
            
            // 鼠标离开地图时取消拖拽
            this.map.getViewport().addEventListener('mouseleave', function() {
                if (self.dragState.isDragging) {
                    self.dragState.isDragging = false;
                    self.showDragHint(false);
                }
            });
        },
        
        // 设置地图鼠标样式
        setMapCursor: function(cursor) {
            const viewport = this.map.getViewport();
            viewport.style.cursor = cursor;
        },
        
        // 显示/隐藏拖拽提示
        showDragHint: function(show) {
            const hint = document.getElementById('dragModeHint');
            if (hint) {
                if (show) {
                    hint.classList.add('active');
                    hint.innerHTML = '<i class="fas fa-arrows-alt"></i> <strong>正在拖拽...</strong> 松开鼠标完成移动';
                } else {
                    hint.classList.remove('active');
                    hint.innerHTML = '<i class="fas fa-hand-paper"></i> <strong>鼠标拖拽模式：</strong>按住 <kbd>Shift</kbd> 键 + 拖动图片可快速调整位置';
                }
            }
        },
        
        // 打开导入对话框
        openImportDialog: function() {
            const self = this;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/jpg';
            input.onchange = function(e) {
                const file = e.target.files[0];
                if (file) {
                    self.importImage(file);
                }
            };
            input.click();
        },
        
        // 导入图片
        importImage: function(file) {
            const self = this;
            const id = 'img_' + Date.now();
            const url = URL.createObjectURL(file);
            
            // 加载图片获取尺寸
            const img = new Image();
            img.onload = function() {
                const width = img.width;
                const height = img.height;
                
                // 计算初始范围
                const center = self.map.getView().getCenter();
                const resolution = self.map.getView().getResolution();
                
                // 估算地理范围（100像素 ≈ resolution米）
                const extentWidth = width * resolution * 2;
                const extentHeight = height * resolution * 2;
                
                const extent = [
                    center[0] - extentWidth / 2,
                    center[1] - extentHeight / 2,
                    center[0] + extentWidth / 2,
                    center[1] + extentHeight / 2
                ];
                
                // 创建图片源和图层
                const source = new ol.source.ImageStatic({
                    url: url,
                    imageExtent: extent,
                    projection: 'EPSG:3857'
                });
                
                const layer = new ol.layer.Image({
                    source: source,
                    opacity: 0.7,
                    zIndex: 5
                });
                
                layer.set('overlayId', id);
                self.map.addLayer(layer);
                
                // 保存信息
                self.overlays.set(id, {
                    id: id,
                    layer: layer,
                    source: source,
                    url: url,
                    name: file.name,
                    width: width,
                    height: height,
                    extent: extent.slice(),
                    originalExtent: extent.slice(),
                    params: { opacity: 0.7, scale: 1, rotation: 0, x: 0, y: 0 }
                });
                
                self.setActiveOverlay(id);
                self.addToList(id);
                
                // 缩放到图片范围
                self.map.getView().fit(extent, {
                    padding: [50, 50, 50, 50],
                    duration: 500
                });
                
                self.showMessage('图片已导入，按住 Shift + 拖动图片可快速调整位置，或使用方向键精确微调', 'info');
            };
            img.src = url;
        },
        
        // 设置激活的图片
        setActiveOverlay: function(id) {
            this.activeOverlayId = id;
            
            // 更新UI选中状态
            document.querySelectorAll('.image-overlay-item').forEach(function(el) {
                el.classList.remove('active');
            });
            
            const item = document.querySelector('[data-overlay-id="' + id + '"]');
            if (item) item.classList.add('active');
            
            // 显示调整面板
            const adjustSection = document.getElementById('adjustSection');
            if (id && this.overlays.has(id)) {
                adjustSection.style.display = 'block';
                const overlay = this.overlays.get(id);
                this.loadParamsToUI(overlay.params);
            } else {
                adjustSection.style.display = 'none';
            }
        },
        
        // 应用到图片
        applyAdjustments: function() {
            if (!this.activeOverlayId) return;
            
            const overlay = this.overlays.get(this.activeOverlayId);
            if (!overlay) return;
            
            // 获取当前参数（确保是有效数字）
            let scale = parseFloat(document.getElementById('scaleSlider').value);
            // 限制缩放范围，防止过小或过大
            scale = Math.max(0.1, Math.min(5, scale));
            
            const params = {
                opacity: parseFloat(document.getElementById('opacitySlider').value) || 0.7,
                scale: scale,
                rotation: parseFloat(document.getElementById('rotationSlider').value) || 0,
                x: parseFloat(document.getElementById('xOffsetSlider').value) || 0,
                y: parseFloat(document.getElementById('yOffsetSlider').value) || 0
            };
            
            overlay.params = params;
            
            // 计算新的范围
            const newExtent = this.calculateExtent(overlay.originalExtent, params);
            overlay.extent = newExtent;
            
            // 强制更新图片源 - 先设置为null再设置新值确保刷新
            overlay.layer.setSource(null);
            
            // 更新图片源
            const newSource = new ol.source.ImageStatic({
                url: overlay.url,
                imageExtent: newExtent,
                projection: 'EPSG:3857'
            });
            
            overlay.source = newSource;
            overlay.layer.setSource(newSource);
            overlay.layer.setOpacity(params.opacity);
            
            // 强制刷新图层
            overlay.layer.changed();
        },
        
        // 计算新范围
        calculateExtent: function(originalExtent, params) {
            const minX = originalExtent[0], minY = originalExtent[1];
            const maxX = originalExtent[2], maxY = originalExtent[3];
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const width = maxX - minX;
            const height = maxY - minY;
            
            // 应用缩放
            const newWidth = width * params.scale;
            const newHeight = height * params.scale;
            
            const halfWidth = newWidth / 2;
            const halfHeight = newHeight / 2;
            
            // 应用偏移
            const newCenterX = centerX + params.x;
            const newCenterY = centerY + params.y;
            
            // 如果有旋转角度，计算旋转后的角点坐标
            if (params.rotation !== 0) {
                const rotationRad = params.rotation * Math.PI / 180;
                const cos = Math.cos(rotationRad);
                const sin = Math.sin(rotationRad);
                
                // 原始四个角点（相对于中心）
                const corners = [
                    { x: -halfWidth, y: -halfHeight }, // 左下
                    { x: halfWidth, y: -halfHeight },  // 右下
                    { x: halfWidth, y: halfHeight },   // 右上
                    { x: -halfWidth, y: halfHeight }   // 左上
                ];
                
                // 旋转后的角点
                const rotatedCorners = corners.map(function(corner) {
                    return {
                        x: newCenterX + (corner.x * cos - corner.y * sin),
                        y: newCenterY + (corner.x * sin + corner.y * cos)
                    };
                });
                
                // 计算旋转后角点的包围盒
                const xs = rotatedCorners.map(function(c) { return c.x; });
                const ys = rotatedCorners.map(function(c) { return c.y; });
                
                return [
                    Math.min.apply(Math, xs),
                    Math.min.apply(Math, ys),
                    Math.max.apply(Math, xs),
                    Math.max.apply(Math, ys)
                ];
            }
            
            // 无旋转时返回简单矩形
            return [
                newCenterX - halfWidth,
                newCenterY - halfHeight,
                newCenterX + halfWidth,
                newCenterY + halfHeight
            ];
        },
        
        // 添加到列表
        addToList: function(id) {
            const overlay = this.overlays.get(id);
            const list = document.getElementById('imageOverlayList');
            
            if (list.querySelector('.no-data')) {
                list.innerHTML = '';
            }
            
            const item = document.createElement('div');
            item.className = 'image-overlay-item';
            item.dataset.overlayId = id;
            item.innerHTML = `
                <div class="item-info">
                    <div class="item-name"><i class="fas fa-image"></i> ${overlay.name}</div>
                    <div class="item-size">${overlay.width} × ${overlay.height}px</div>
                </div>
                <div class="item-actions">
                    <button class="btn-icon btn-visibility" title="显示/隐藏">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon btn-delete" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            
            const self = this;
            item.addEventListener('click', function() {
                self.setActiveOverlay(id);
            });
            
            item.querySelector('.btn-visibility').addEventListener('click', function(e) {
                e.stopPropagation();
                self.toggleVisibility(id);
            });
            
            item.querySelector('.btn-delete').addEventListener('click', function(e) {
                e.stopPropagation();
                self.removeOverlay(id);
            });
            
            list.appendChild(item);
        },
        
        // 切换可见性
        toggleVisibility: function(id) {
            const overlay = this.overlays.get(id);
            if (overlay) {
                const visible = overlay.layer.getVisible();
                overlay.layer.setVisible(!visible);
            }
        },
        
        // 删除图片
        removeOverlay: function(id) {
            const overlay = this.overlays.get(id);
            if (overlay) {
                this.map.removeLayer(overlay.layer);
                URL.revokeObjectURL(overlay.url);
                this.overlays.delete(id);
                
                if (this.activeOverlayId === id) {
                    this.activeOverlayId = null;
                    document.getElementById('adjustSection').style.display = 'none';
                }
                
                const item = document.querySelector('[data-overlay-id="' + id + '"]');
                if (item) item.remove();
                
                if (this.overlays.size === 0) {
                    document.getElementById('imageOverlayList').innerHTML = 
                        '<div class="no-data">暂无图片，请点击"导入"添加社区平面图</div>';
                }
            }
        },
        
        // 重置参数
        resetParams: function() {
            document.getElementById('opacitySlider').value = 0.7;
            document.getElementById('scaleSlider').value = 1;
            document.getElementById('rotationSlider').value = 0;
            document.getElementById('xOffsetSlider').value = 0;
            document.getElementById('yOffsetSlider').value = 0;
            
            document.getElementById('opacityValue').textContent = '70%';
            document.getElementById('scaleValue').textContent = '1.0x';
            document.getElementById('rotationValue').textContent = '0°';
            document.getElementById('xOffsetValue').textContent = '0m';
            document.getElementById('yOffsetValue').textContent = '0m';
            
            this.applyAdjustments();
        },
        
        // 锁定/解锁
        toggleLock: function() {
            const btn = document.getElementById('lockImageBtn');
            const locked = btn.classList.contains('locked');
            const controls = document.querySelectorAll('#adjustSection input');
            
            if (locked) {
                btn.classList.remove('locked');
                btn.innerHTML = '<i class="fas fa-lock"></i> 锁定位置';
                controls.forEach(function(ctrl) { ctrl.disabled = false; });
                this.setMapCursor('');
            } else {
                btn.classList.add('locked');
                btn.innerHTML = '<i class="fas fa-unlock"></i> 解锁位置';
                controls.forEach(function(ctrl) { ctrl.disabled = true; });
                this.setMapCursor('');
                this.showMessage('图片已锁定，现在可以在上方绘制学区边界了（按 Shift 拖拽可临时解锁）', 'success');
            }
        },
        
        // 加载参数到UI
        loadParamsToUI: function(params) {
            document.getElementById('opacitySlider').value = params.opacity;
            document.getElementById('scaleSlider').value = params.scale;
            document.getElementById('rotationSlider').value = params.rotation;
            document.getElementById('xOffsetSlider').value = params.x;
            document.getElementById('yOffsetSlider').value = params.y;
            
            document.getElementById('opacityValue').textContent = Math.round(params.opacity * 100) + '%';
            document.getElementById('scaleValue').textContent = params.scale.toFixed(1) + 'x';
            document.getElementById('rotationValue').textContent = params.rotation + '°';
            document.getElementById('xOffsetValue').textContent = params.x + 'm';
            document.getElementById('yOffsetValue').textContent = params.y + 'm';
        },
        
        // 显示面板
        show: function() {
            this.panel.classList.add('show');
        },
        
        // 隐藏面板
        hide: function() {
            this.panel.classList.remove('show');
            this.setMapCursor('');
        },
        
        // 显示消息
        showMessage: function(msg, type) {
            if (window.showMessage) {
                window.showMessage(msg, type);
            } else {
                console.log('[' + type + '] ' + msg);
            }
        }
    };
})();
