#!/usr/bin/env python3
"""
优化乌骓马精灵图 - 降低分辨率
从 3840x2160 降低到 1920x1080
保持164帧
"""

from PIL import Image
import os

INPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-wuzhui.png"
OUTPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-wuzhui-optimized.png"

# 禁用解压炸弹检查
Image.MAX_IMAGE_PIXELS = None

# 原始配置
ORIGINAL_COLS = 8
ORIGINAL_ROWS = 21
ORIGINAL_FRAME_WIDTH = 3840
ORIGINAL_FRAME_HEIGHT = 2160
TOTAL_FRAMES = 164

# 新配置 - 降低分辨率到一半
NEW_FRAME_WIDTH = 1920
NEW_FRAME_HEIGHT = 1080

def optimize_sprite():
    print(f"开始优化乌骓马精灵图（降低分辨率）...")
    print(f"输入文件: {INPUT_FILE}")

    # 获取原始文件大小
    original_size = os.path.getsize(INPUT_FILE) / (1024 * 1024)
    print(f"原始文件大小: {original_size:.2f} MB")
    print(f"原始每帧尺寸: {ORIGINAL_FRAME_WIDTH} x {ORIGINAL_FRAME_HEIGHT}")

    # 加载图片
    print("加载图片...")
    img = Image.open(INPUT_FILE)

    # 创建新的精灵图画布
    new_width = NEW_FRAME_WIDTH * ORIGINAL_COLS
    new_height = NEW_FRAME_HEIGHT * ORIGINAL_ROWS
    print(f"新画布尺寸: {new_width} x {new_height}")
    print(f"新每帧尺寸: {NEW_FRAME_WIDTH} x {NEW_FRAME_HEIGHT}")

    new_sprite = Image.new('RGBA', (new_width, new_height), (0, 0, 0, 0))

    # 提取并缩放每一帧
    for i in range(TOTAL_FRAMES):
        # 计算原始帧位置
        col = i % ORIGINAL_COLS
        row = i // ORIGINAL_COLS
        orig_x = col * ORIGINAL_FRAME_WIDTH
        orig_y = row * ORIGINAL_FRAME_HEIGHT

        # 提取帧
        frame = img.crop((
            orig_x,
            orig_y,
            orig_x + ORIGINAL_FRAME_WIDTH,
            orig_y + ORIGINAL_FRAME_HEIGHT
        ))

        # 缩放到新尺寸（使用高质量的LANCZOS算法）
        frame_resized = frame.resize((NEW_FRAME_WIDTH, NEW_FRAME_HEIGHT), Image.Resampling.LANCZOS)

        # 计算新位置
        new_x = col * NEW_FRAME_WIDTH
        new_y = row * NEW_FRAME_HEIGHT

        # 粘贴到新画布
        new_sprite.paste(frame_resized, (new_x, new_y))

        if (i + 1) % 10 == 0:
            print(f"处理进度: {i + 1}/{TOTAL_FRAMES}")

    # 保存
    print(f"保存到: {OUTPUT_FILE}")
    new_sprite.save(OUTPUT_FILE, 'PNG', optimize=True, compress_level=9)

    # 获取优化后文件大小
    optimized_size = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"✅ 完成!")
    print(f"优化后文件大小: {optimized_size:.2f} MB")
    print(f"压缩率: {(1 - optimized_size/original_size)*100:.1f}%")
    print(f"\n新配置:")
    print(f"  frameWidth: {NEW_FRAME_WIDTH}")
    print(f"  frameHeight: {NEW_FRAME_HEIGHT}")
    print(f"  frameCount: {TOTAL_FRAMES}")
    print(f"  framesPerRow: {ORIGINAL_COLS}")
    print(f"  scale: 0.08")

if __name__ == "__main__":
    optimize_sprite()
