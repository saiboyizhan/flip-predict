#!/usr/bin/env python3
"""
创建绝影马精灵图 - 只使用真正的奔跑帧
基于分析结果，使用帧 40-63（24帧流畅奔跑）
"""

from PIL import Image
import os
import glob

# 禁用解压炸弹检查
Image.MAX_IMAGE_PIXELS = None

SOURCE_DIR = "/Users/xiaobai/pr/3"
OUTPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-jueying-hd.png"

# 选择的帧范围 - 真正的奔跑帧
START_FRAME = 40
END_FRAME = 63
TOTAL_FRAMES = END_FRAME - START_FRAME + 1  # 24帧

FRAME_WIDTH = 1920
FRAME_HEIGHT = 1088
COLS = 6
ROWS = 4

# 缩放比例 - 提高到80%保持高清
SCALE = 0.8

def create_smooth_sprite():
    print(f"创建流畅的绝影马精灵图...")
    print(f"使用帧 {START_FRAME}-{END_FRAME} (共{TOTAL_FRAMES}帧)")

    # 获取所有PNG文件
    png_files = sorted(glob.glob(os.path.join(SOURCE_DIR, "*.png")))
    print(f"找到 {len(png_files)} 个PNG文件")

    # 选择指定范围的帧
    selected_frames = png_files[START_FRAME:END_FRAME+1]
    print(f"选择了 {len(selected_frames)} 帧")

    # 计算缩放后的尺寸
    scaled_width = int(FRAME_WIDTH * SCALE)
    scaled_height = int(FRAME_HEIGHT * SCALE)

    # 创建精灵图画布
    sprite_width = scaled_width * COLS
    sprite_height = scaled_height * ROWS

    print(f"创建精灵图画布: {sprite_width} x {sprite_height} 像素")
    print(f"每帧尺寸: {scaled_width} x {scaled_height}")

    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 合并每一帧
    for idx, png_file in enumerate(selected_frames):
        if idx % 5 == 0:
            print(f"处理进度: {idx}/{TOTAL_FRAMES}")

        # 计算位置
        col = idx % COLS
        row = idx // COLS
        x = col * scaled_width
        y = row * scaled_height

        # 加载、缩放并粘贴图片
        try:
            frame = Image.open(png_file)

            # 确保是RGBA模式
            if frame.mode != 'RGBA':
                frame = frame.convert('RGBA')

            # 缩放帧
            frame_resized = frame.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)

            # 使用alpha合成，保持透明度
            sprite_sheet.paste(frame_resized, (x, y), frame_resized)

            frame.close()
            frame_resized.close()
        except Exception as e:
            print(f"错误: 无法处理 {png_file}: {e}")

    print(f"保存精灵图到: {OUTPUT_FILE}")
    sprite_sheet.save(OUTPUT_FILE, 'PNG', optimize=True, compress_level=9)

    # 获取文件大小
    file_size = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"✅ 完成! 文件大小: {file_size:.2f} MB")
    print(f"\n精灵图信息:")
    print(f"  - 总尺寸: {sprite_width} x {sprite_height}")
    print(f"  - 每帧: {scaled_width} x {scaled_height}")
    print(f"  - 布局: {COLS} 列 x {ROWS} 行")
    print(f"  - 总帧数: {TOTAL_FRAMES}")
    print(f"  - 使用的原始帧: {START_FRAME}-{END_FRAME}")
    print(f"\n建议配置:")
    print(f"  - frameWidth: {scaled_width}")
    print(f"  - frameHeight: {scaled_height}")
    print(f"  - frameCount: {TOTAL_FRAMES}")
    print(f"  - framesPerRow: {COLS}")
    print(f"  - fps: 6 (推荐，让步伐更自然)")

if __name__ == "__main__":
    create_smooth_sprite()
