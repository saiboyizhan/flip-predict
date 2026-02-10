#!/usr/bin/env python3
"""
优化穆王八骏精灵图，减小文件大小
"""

from PIL import Image
import os

def optimize_sprite():
    input_file = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-muwang.png"

    print(f"加载精灵图: {input_file}")
    img = Image.open(input_file)

    original_size = os.path.getsize(input_file) / (1024 * 1024)
    print(f"原始大小: {original_size:.2f} MB")
    print(f"原始尺寸: {img.size}")

    # 优化选项1: 压缩PNG
    print("\n正在优化...")
    img.save(input_file, 'PNG', optimize=True, compress_level=9)

    optimized_size = os.path.getsize(input_file) / (1024 * 1024)
    print(f"优化后大小: {optimized_size:.2f} MB")
    print(f"节省: {original_size - optimized_size:.2f} MB ({(1 - optimized_size/original_size)*100:.1f}%)")

    print(f"\n✅ 优化完成！")

if __name__ == "__main__":
    optimize_sprite()
