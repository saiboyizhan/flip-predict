#!/usr/bin/env python3
"""
帧图优化工具 - 去除停顿帧，只保留流畅的动画部分
"""

from PIL import Image
import os
import numpy as np

def calculate_frame_difference(img1, img2):
    """计算两帧之间的差异"""
    arr1 = np.array(img1)
    arr2 = np.array(img2)
    diff = np.abs(arr1.astype(float) - arr2.astype(float))
    return np.mean(diff)

def analyze_frames(image_folder):
    """分析帧序列，找出停顿的部分"""
    print("🔍 分析帧序列...")

    images = []
    filenames = []

    for filename in sorted(os.listdir(image_folder)):
        if filename.lower().endswith('.png'):
            img_path = os.path.join(image_folder, filename)
            img = Image.open(img_path)
            images.append(img)
            filenames.append(filename)

    print(f"📊 总共 {len(images)} 帧")

    # 计算相邻帧之间的差异
    differences = []
    for i in range(len(images) - 1):
        diff = calculate_frame_difference(images[i], images[i + 1])
        differences.append(diff)
        if i % 20 == 0:
            print(f"  分析进度: {i+1}/{len(images)}")

    # 找出差异的阈值
    avg_diff = np.mean(differences)
    std_diff = np.std(differences)
    threshold = avg_diff * 0.3  # 低于平均值30%的认为是停顿

    print(f"\n📈 差异统计:")
    print(f"   平均差异: {avg_diff:.2f}")
    print(f"   标准差: {std_diff:.2f}")
    print(f"   停顿阈值: {threshold:.2f}")

    # 找出停顿的区间
    paused_frames = []
    for i, diff in enumerate(differences):
        if diff < threshold:
            paused_frames.append(i)

    # 分组连续的停顿帧
    pause_groups = []
    if paused_frames:
        current_group = [paused_frames[0]]
        for frame in paused_frames[1:]:
            if frame == current_group[-1] + 1:
                current_group.append(frame)
            else:
                if len(current_group) > 5:  # 只关注连续停顿超过5帧的
                    pause_groups.append(current_group)
                current_group = [frame]
        if len(current_group) > 5:
            pause_groups.append(current_group)

    print(f"\n⏸️  发现 {len(pause_groups)} 个停顿区间:")
    for i, group in enumerate(pause_groups):
        print(f"   区间 {i+1}: 帧 {group[0]} - {group[-1]} (共 {len(group)} 帧)")

    return images, filenames, differences, pause_groups

def select_best_frames(images, filenames, differences, target_frames=48):
    """选择最佳的帧，去除停顿"""
    print(f"\n🎯 选择最佳的 {target_frames} 帧...")

    # 找出运动最明显的帧
    sorted_indices = np.argsort(differences)[::-1]  # 从大到小排序

    # 选择差异最大的帧，但要保持顺序
    selected_indices = sorted(sorted_indices[:target_frames])

    selected_images = [images[i] for i in selected_indices]
    selected_filenames = [filenames[i] for i in selected_indices]

    print(f"✅ 已选择 {len(selected_images)} 帧")
    print(f"   帧范围: {selected_indices[0]} - {selected_indices[-1]}")

    return selected_images, selected_filenames

def extract_motion_cycle(images, filenames, differences):
    """提取一个完整的运动循环"""
    print(f"\n🔄 提取运动循环...")

    # 找出差异最大的区间（最活跃的部分）
    window_size = 48
    max_activity = 0
    best_start = 0

    for i in range(len(differences) - window_size):
        activity = sum(differences[i:i+window_size])
        if activity > max_activity:
            max_activity = activity
            best_start = i

    print(f"   最佳循环: 帧 {best_start} - {best_start + window_size}")

    selected_images = images[best_start:best_start + window_size]
    selected_filenames = filenames[best_start:best_start + window_size]

    return selected_images, selected_filenames

def create_optimized_sprite_sheet(selected_images, output_path, frames_per_row=8):
    """创建优化后的精灵图"""
    print(f"\n🎨 创建优化后的精灵图...")

    frame_width, frame_height = selected_images[0].size
    total_frames = len(selected_images)
    rows = (total_frames + frames_per_row - 1) // frames_per_row

    sprite_width = frame_width * frames_per_row
    sprite_height = frame_height * rows

    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    for i, img in enumerate(selected_images):
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * frame_width
        y = row * frame_height
        sprite_sheet.paste(img, (x, y))

    sprite_sheet.save(output_path, 'PNG')
    file_size = os.path.getsize(output_path) / 1024

    print(f"✅ 优化完成!")
    print(f"   输出文件: {output_path}")
    print(f"   文件大小: {file_size:.2f} KB")
    print(f"   总帧数: {total_frames}")
    print(f"   精灵图尺寸: {sprite_width}x{sprite_height}")

    return total_frames, frames_per_row

def main():
    import sys

    if len(sys.argv) < 2:
        print("使用方法:")
        print("  python optimize_frames.py <图片文件夹> [输出文件] [目标帧数]")
        print("\n示例:")
        print("  python optimize_frames.py /Users/xiaobai/pr/1")
        print("  python optimize_frames.py /Users/xiaobai/pr/1 public/horse-sprite-optimized.png 48")
        return

    image_folder = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "horse-sprite-optimized.png"
    target_frames = int(sys.argv[3]) if len(sys.argv) > 3 else 48

    # 分析帧
    images, filenames, differences, pause_groups = analyze_frames(image_folder)

    # 提取运动循环
    selected_images, selected_filenames = extract_motion_cycle(images, filenames, differences)

    # 创建精灵图
    total_frames, frames_per_row = create_optimized_sprite_sheet(
        selected_images,
        output_path,
        frames_per_row=8
    )

    print(f"\n📝 在代码中使用:")
    print(f"""
<SpriteAnimation
  spriteSheet="/horse-sprite-optimized.png"
  frameWidth={{{selected_images[0].size[0]}}}
  frameHeight={{{selected_images[0].size[1]}}}
  frameCount={{{total_frames}}}
  framesPerRow={{{frames_per_row}}}
  fps={{24}}
  isPlaying={{true}}
/>
""")

if __name__ == "__main__":
    main()
