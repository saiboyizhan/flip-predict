#!/usr/bin/env python3
"""
进一步优化绝影马精灵图 - 减少帧数到48帧
从192帧中每隔4帧取1帧，保持流畅度
"""

from PIL import Image
import os

INPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-jueying-optimized.png"
OUTPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-jueying-48.png"

# 禁用解压炸弹检查
Image.MAX_IMAGE_PIXELS = None

# 原始配置
ORIGINAL_COLS = 16
ORIGINAL_ROWS = 12
ORIGINAL_FRAME_WIDTH = 960
ORIGINAL_FRAME_HEIGHT = 544
ORIGINAL_TOTAL_FRAMES = 192

# 新配置 - 48帧（每4帧取1帧）
NEW_TOTAL_FRAMES = 48
NEW_COLS = 8
NEW_ROWS = 6
FRAME_SKIP = 4  # 每4帧取1帧

def optimize_sprite():
    print(f"开始优化精灵图（减少帧数）...")
    print(f"输入文件: {INPUT_FILE}")

    # 获取原始文件大小
    original_size = os.path.getsize(INPUT_FILE) / (1024 * 1024)
    print(f"原始文件大小: {original_size:.2f} MB")
    print(f"原始帧数: {ORIGINAL_TOTAL_FRAMES}")

    # 加载图片
    print("加载图片...")
    img = Image.open(INPUT_FILE)

    # 创建新的精灵图画布
    new_width = ORIGINAL_FRAME_WIDTH * NEW_COLS
    new_height = ORIGINAL_FRAME_HEIGHT * NEW_ROWS
    print(f"新画布尺寸: {new_width} x {new_height}")
    print(f"新帧数: {NEW_TOTAL_FRAMES} (每{FRAME_SKIP}帧取1帧)")

    new_sprite = Image.new('RGBA', (new_width, new_height), (0, 0, 0, 0))

    # 提取并重组帧
    frame_index = 0
    for i in range(0, ORIGINAL_TOTAL_FRAMES, FRAME_SKIP):
        if frame_index >= NEW_TOTAL_FRAMES:
            break

        # 计算原始帧位置
        orig_col = i % ORIGINAL_COLS
        orig_row = i // ORIGINAL_COLS
        orig_x = orig_col * ORIGINAL_FRAME_WIDTH
        orig_y = orig_row * ORIGINAL_FRAME_HEIGHT

        # 提取帧
        frame = img.crop((
            orig_x,
            orig_y,
            orig_x + ORIGINAL_FRAME_WIDTH,
            orig_y + ORIGINAL_FRAME_HEIGHT
        ))

        # 计算新位置
        new_col = frame_index % NEW_COLS
        new_row = frame_index // NEW_COLS
        new_x = new_col * ORIGINAL_FRAME_WIDTH
        new_y = new_row * ORIGINAL_FRAME_HEIGHT

        # 粘贴到新画布
        new_sprite.paste(frame, (new_x, new_y))

        if frame_index % 10 == 0:
            print(f"处理进度: {frame_index}/{NEW_TOTAL_FRAMES}")

        frame_index += 1

    # 保存
    print(f"保存到: {OUTPUT_FILE}")
    new_sprite.save(OUTPUT_FILE, 'PNG', optimize=True, compress_level=9)

    # 获取优化后文件大小
    optimized_size = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"✅ 完成!")
    print(f"优化后文件大小: {optimized_size:.2f} MB")
    print(f"压缩率: {(1 - optimized_size/original_size)*100:.1f}%")
    print(f"新配置:")
    print(f"  - 尺寸: {new_width} x {new_height}")
    print(f"  - 每帧: {ORIGINAL_FRAME_WIDTH} x {ORIGINAL_FRAME_HEIGHT}")
    print(f"  - 布局: {NEW_COLS} 列 x {NEW_ROWS} 行")
    print(f"  - 总帧数: {NEW_TOTAL_FRAMES}")

if __name__ == "__main__":
    optimize_sprite()
