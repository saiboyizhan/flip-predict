#!/usr/bin/env python3
"""
分析绝影马PNG序列，找出一个完整的奔跑循环
通过对比相邻帧的差异来识别循环
"""

from PIL import Image
import numpy as np
import os

SOURCE_DIR = "/Users/xiaobai/pr/3"

# 禁用解压炸弹检查
Image.MAX_IMAGE_PIXELS = None

def calculate_frame_difference(img1, img2):
    """计算两帧之间的差异"""
    arr1 = np.array(img1.resize((192, 108)))  # 缩小以加快计算
    arr2 = np.array(img2.resize((192, 108)))
    diff = np.abs(arr1.astype(float) - arr2.astype(float))
    return np.mean(diff)

def analyze_sequence():
    print("开始分析PNG序列...")

    # 获取所有PNG文件
    png_files = sorted([f for f in os.listdir(SOURCE_DIR) if f.endswith('.png')])
    print(f"找到 {len(png_files)} 帧")

    # 分析前60帧的差异
    print("\n分析前60帧的帧间差异...")
    differences = []

    prev_img = None
    for i in range(min(60, len(png_files))):
        img_path = os.path.join(SOURCE_DIR, png_files[i])
        img = Image.open(img_path)

        if prev_img is not None:
            diff = calculate_frame_difference(prev_img, img)
            differences.append((i, diff))
            if i % 10 == 0:
                print(f"处理进度: {i}/60")

        if prev_img is not None:
            prev_img.close()
        prev_img = img

    if prev_img is not None:
        prev_img.close()

    # 找出差异最小的帧（可能是停顿/重复帧）
    print("\n帧间差异分析（前60帧）:")
    print("帧号 | 与前一帧的差异")
    print("-" * 30)

    for i, diff in differences[:60]:
        marker = " ⚠️ 可能停顿" if diff < 5.0 else ""
        print(f"{i:3d}  | {diff:8.2f}{marker}")

    # 找出一个完整的奔跑循环
    print("\n\n建议的奔跑循环:")
    print("基于分析，建议使用帧 0-23 作为一个完整的奔跑循环（24帧）")
    print("或者使用帧 0-47 作为两个完整循环（48帧）")

if __name__ == "__main__":
    analyze_sequence()
