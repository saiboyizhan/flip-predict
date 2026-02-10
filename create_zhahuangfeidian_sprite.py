#!/usr/bin/env python3
"""
爪黄飞电精灵图制作工具
将 /Users/xiaobai/pr/7 中的序列帧合成为精灵图
"""

from PIL import Image
import os

def create_zhahuangfeidian_sprite():
    """创建爪黄飞电的精灵图"""

    # 输入和输出路径
    input_folder = "/Users/xiaobai/pr/7"
    output_path = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-zhahuangfeidian.png"

    print("🐎 爪黄飞电精灵图制作工具")
    print("=" * 50)
    print(f"📂 输入文件夹: {input_folder}")
    print(f"💾 输出文件: {output_path}")
    print()

    # 获取所有序列帧
    print("🔍 正在扫描序列帧...")
    images = []
    filenames = []

    for filename in sorted(os.listdir(input_folder)):
        if filename.startswith("序列 0xun") and filename.endswith(".png"):
            img_path = os.path.join(input_folder, filename)
            try:
                img = Image.open(img_path)
                # 转换为 RGBA 模式
                if img.mode != 'RGBA':
                    img = img.convert('RGBA')
                images.append(img)
                filenames.append(filename)
                if len(images) <= 5 or len(images) % 10 == 0:
                    print(f"  ✓ 加载第 {len(images)} 帧: {filename} ({img.size[0]}x{img.size[1]})")
            except Exception as e:
                print(f"  ✗ 跳过: {filename} (错误: {e})")

    if not images:
        print("❌ 没有找到有效的序列帧！")
        return False

    print(f"\n📊 总共找到 {len(images)} 帧")

    # 检查尺寸
    sizes = [img.size for img in images]
    if len(set(sizes)) > 1:
        print("⚠️  警告: 图片尺寸不一致！")
        max_width = max(s[0] for s in sizes)
        max_height = max(s[1] for s in sizes)
        frame_width, frame_height = max_width, max_height
        print(f"   使用最大尺寸: {frame_width}x{frame_height}")

        # 调整所有图片到相同尺寸
        adjusted_images = []
        for i, img in enumerate(images):
            if img.size != (max_width, max_height):
                new_img = Image.new('RGBA', (max_width, max_height), (0, 0, 0, 0))
                offset_x = (max_width - img.size[0]) // 2
                offset_y = (max_height - img.size[1]) // 2
                new_img.paste(img, (offset_x, offset_y))
                adjusted_images.append(new_img)
            else:
                adjusted_images.append(img)
        images = adjusted_images
    else:
        frame_width, frame_height = images[0].size
        print(f"✓ 所有图片尺寸一致: {frame_width}x{frame_height}")

    # 计算布局 - 77帧，使用 11 列 x 7 行
    frames_per_row = 11
    total_frames = len(images)
    rows = (total_frames + frames_per_row - 1) // frames_per_row

    sprite_width = frame_width * frames_per_row
    sprite_height = frame_height * rows

    print(f"\n🎨 创建精灵图:")
    print(f"   总帧数: {total_frames}")
    print(f"   每帧尺寸: {frame_width}x{frame_height}")
    print(f"   布局: {frames_per_row} 列 x {rows} 行")
    print(f"   精灵图尺寸: {sprite_width}x{sprite_height}")

    # 创建空白画布
    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 粘贴每一帧
    print("\n📐 正在拼接帧...")
    for i, img in enumerate(images):
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * frame_width
        y = row * frame_height
        sprite_sheet.paste(img, (x, y))
        if (i + 1) % 10 == 0 or i == len(images) - 1:
            print(f"  ✓ 已完成 {i+1}/{total_frames} 帧")

    # 保存
    print("\n💾 正在保存精灵图...")
    sprite_sheet.save(output_path, 'PNG', optimize=True)
    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)

    print(f"\n✅ 爪黄飞电精灵图创建成功!")
    print(f"   输出文件: {output_path}")
    print(f"   文件大小: {file_size_mb:.2f} MB")

    # 生成使用代码
    print(f"\n📝 在 React 代码中使用:")
    print("=" * 50)
    print(f"""
const ZHAHUANGFEIDIAN_SPRITE = {{
  spriteSheet: "/horse-sprite-zhahuangfeidian.png",
  frameWidth: {frame_width},
  frameHeight: {frame_height},
  frameCount: {total_frames},
  framesPerRow: {frames_per_row},
  fps: 24  // 可调整帧率
}};
""")

    return True

if __name__ == "__main__":
    create_zhahuangfeidian_sprite()
