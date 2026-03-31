import json

def polygon_to_linestring(coordinates):
    """将多边形坐标转换为线坐标（闭合线段）"""
    lines = []
    # 对于Polygon，coordinates是一个列表的列表：[[[x,y], [x,y], ...]]
    # 第一个环是外边界，后面的环是内边界（孔洞）
    for ring in coordinates:
        # 每个环都是一个线
        lines.append(ring)
    return lines

def multipolygon_to_multilinestring(coordinates):
    """将MultiPolygon坐标转换为MultiLineString坐标"""
    all_lines = []
    # MultiPolygon是三维数组：[[[[x,y], ...]], [[[x,y], ...]]]
    for polygon in coordinates:
        for ring in polygon:
            # 每个环是一个线
            all_lines.append(ring)
    return all_lines

def convert_feature_geometry(feature):
    """转换单个要素的几何类型"""
    geom = feature['geometry']
    geom_type = geom['type']
    coords = geom['coordinates']
    
    if geom_type == 'Polygon':
        # 将Polygon转换为MultiLineString（可能包含多个环）
        lines = polygon_to_linestring(coords)
        return {
            'type': 'MultiLineString',
            'coordinates': lines
        }
    elif geom_type == 'MultiPolygon':
        # 将MultiPolygon转换为MultiLineString
        lines = multipolygon_to_multilinestring(coords)
        return {
            'type': 'MultiLineString',
            'coordinates': lines
        }
    else:
        # 其他类型保持不变
        return geom

def convert_geojson(input_file, output_file):
    """转换整个GeoJSON文件"""
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 转换每个要素
    for feature in data['features']:
        feature['geometry'] = convert_feature_geometry(feature)
    
    # 保存结果
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"转换完成！输出文件: {output_file}")
    
    # 统计信息
    feature_count = len(data['features'])
    total_lines = 0
    for feature in data['features']:
        geom = feature['geometry']
        if geom['type'] == 'MultiLineString':
            total_lines += len(geom['coordinates'])
    
    print(f"要素数量: {feature_count}")
    print(f"总线段数: {total_lines}")

if __name__ == '__main__':
    input_path = r'C:\Users\Administrator\.copaw\gis-app\岳塘区和雨湖区.geojson'
    output_path = r'C:\Users\Administrator\.copaw\gis-app\岳塘区和雨湖区_线段.geojson'
    convert_geojson(input_path, output_path)
