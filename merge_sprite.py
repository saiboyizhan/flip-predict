#!/usr/bin/env python3
"""
合并绝影马PNG序列为精灵图
192帧 -> 16列 x 12行
"""

from PIL import Image
import os
import glob

# 配置
SOURCE_DIR = "/Users/xiaobai/pr/3"
OUTPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-jueying.png"
FRAME_WIDTH = 1920
FRAME_HEIGHT = 1088
COLS = 16
ROWS = 12
TOTAL_FRAMES = 192

def merge_sprite_sheet():
    print(f"开始合并精灵图...")
    print(f"源目录: {SOURCE_DIR}")
    print(f"输出文件: {OUTPUT_FILE}")
    print(f"布局: {COLS}列 x {ROWS}行 = {COLS * ROWS}帧")

    # 获取所有PNG文件并排序
    png_files = sorted(glob.glob(os.path.join(SOURCE_DIR, "*.png")))

    if len(png_files) != TOTAL_FRAMES:
        print(f"警告: 找到 {len(png_files)} 帧，预期 {TOTAL_FRAMES} 帧")

    print(f"找到 {len(png_files)} 个PNG文件")

    # 创建精灵图画布
    sprite_width = FRAME_WIDTH * COLS
    sprite_height = FRAME_HEIGHT * ROWS

    print(f"创建精灵图画布: {sprite_width} x {sprite_height} 像素")

    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 合并每一帧
    for idx, png_file in enumerate(png_files[:TOTAL_FRAMES]):
        if idx % 20 == 0:
            print(f"处理进度: {idx}/{TOTAL_FRAMES} ({idx*100//TOTAL_FRAMES}%)")

        # 计算位置
        col = idx % COLS
        row = idx // COLS
        x = col * FRAME_WIDTH
        y = row * FRAME_HEIGHT

        # 加载并粘贴图片
        try:
            frame = Image.open(png_file)
            sprite_sheet.paste(frame, (x, y))
            frame.close()
        except Exception as e:
            print(f"错误: 无法处理 {png_file}: {e}")

    print(f"保存精灵图到: {OUTPUT_FILE}")
    sprite_sheet.save(OUTPUT_FILE, 'PNG', optimize=True)

    # 获取文件大小
    file_size = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"✅ 完成! 文件大小: {file_size:.2f} MB")
    print(f"精灵图信息:")
    print(f"  - 总尺寸: {sprite_width} x {sprite_height}")
    print(f"  - 每帧: {FRAME_WIDTH} x {FRAME_HEIGHT}")
    print(f"  - 布局: {COLS} 列 x {ROWS} 行")
    print(f"  - 总帧数: {TOTAL_FRAMES}")

if __name__ == "__main__":
    merge_sprite_sheet()
