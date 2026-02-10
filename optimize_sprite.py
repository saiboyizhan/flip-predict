#!/usr/bin/env python3
"""
优化绝影马精灵图 - 缩小尺寸并压缩
"""

from PIL import Image
import os

# 禁用解压炸弹检查
Image.MAX_IMAGE_PIXELS = None

INPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-jueying.png"
OUTPUT_FILE = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-jueying-optimized.png"

# 缩放比例 - 缩小到50%
SCALE = 0.5

def optimize_sprite():
    print(f"开始优化精灵图...")
    print(f"输入文件: {INPUT_FILE}")

    # 获取原始文件大小
    original_size = os.path.getsize(INPUT_FILE) / (1024 * 1024)
    print(f"原始文件大小: {original_size:.2f} MB")

    # 加载图片
    print("加载图片...")
    img = Image.open(INPUT_FILE)
    original_width, original_height = img.size
    print(f"原始尺寸: {original_width} x {original_height}")

    # 缩放
    new_width = int(original_width * SCALE)
    new_height = int(original_height * SCALE)
    print(f"缩放到: {new_width} x {new_height} ({SCALE*100}%)")

    img_resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

    # 保存优化版本
    print(f"保存优化版本到: {OUTPUT_FILE}")
    img_resized.save(OUTPUT_FILE, 'PNG', optimize=True, compress_level=9)

    # 获取优化后文件大小
    optimized_size = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"✅ 完成!")
    print(f"优化后文件大小: {optimized_size:.2f} MB")
    print(f"压缩率: {(1 - optimized_size/original_size)*100:.1f}%")
    print(f"新尺寸: {new_width} x {new_height}")
    print(f"每帧尺寸: {new_width//16} x {new_height//12}")

if __name__ == "__main__":
    optimize_sprite()
