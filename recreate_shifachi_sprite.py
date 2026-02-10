#!/usr/bin/env python3
"""
重新创建什伐赤精灵图，避免平移帧
从192帧中选择前120帧的48帧，确保是连续的跑步动作
"""

from PIL import Image
import os

def recreate_shifachi_sprite():
    # 源文件夹
    source_dir = "/Users/xiaobai/pr/14"

    # 输出文件
    output_file = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-shifachi.png"

    # 获取所有帧文件
    frame_files = sorted([f for f in os.listdir(source_dir) if f.endswith('.png')])
    print(f"找到 {len(frame_files)} 帧")

    # 只使用前120帧，避免后面可能的平移或停顿帧
    useful_frames = frame_files[:120]

    # 从前120帧中均匀选择48帧
    total_frames = len(useful_frames)
    selected_indices = [int(i * total_frames / 48) for i in range(48)]
    selected_files = [useful_frames[i] for i in selected_indices]

    print(f"从前{total_frames}帧中选择了 {len(selected_files)} 帧")
    print(f"第一帧: {selected_files[0]}")
    print(f"最后一帧: {selected_files[-1]}")

    # 读取第一帧获取尺寸
    first_frame = Image.open(os.path.join(source_dir, selected_files[0]))
    frame_width, frame_height = first_frame.size
    print(f"每帧尺寸: {frame_width}x{frame_height}")

    # 创建8x6布局的精灵图
    cols = 8
    rows = 6
    sprite_width = frame_width * cols
    sprite_height = frame_height * rows

    print(f"精灵图尺寸: {sprite_width}x{sprite_height}")

    # 创建空白精灵图
    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 将48帧放置到精灵图中
    for idx, filename in enumerate(selected_files):
        frame_path = os.path.join(source_dir, filename)
        frame = Image.open(frame_path)

        # 计算位置
        col = idx % cols
        row = idx // cols
        x = col * frame_width
        y = row * frame_height

        # 粘贴帧
        sprite_sheet.paste(frame, (x, y))

        if (idx + 1) % 10 == 0:
            print(f"处理进度: {idx + 1}/{len(selected_files)}")

    # 保存精灵图
    print(f"保存精灵图到: {output_file}")
    sprite_sheet.save(output_file, 'PNG', optimize=True, compress_level=9)

    # 获取文件大小
    file_size = os.path.getsize(output_file) / (1024 * 1024)
    print(f"✅ 完成！文件大小: {file_size:.2f} MB")

    print(f"\n已重新生成精灵图，避免了平移帧")

if __name__ == "__main__":
    recreate_shifachi_sprite()
