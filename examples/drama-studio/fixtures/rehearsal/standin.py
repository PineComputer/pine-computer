#!/usr/bin/env python3
"""Stands in for Pine's drama skill in a rehearsal of the studio's flow.

Each command writes placeholder pictures or clips where the drama skill would, under the
work directory's drama/ folder, at the next free version, and prints each path it wrote.
Return those paths with your question or result.

  look CHARACTER [--state S1] [--name NAME]   a look sheet (the base look, or a state such as a wedding look)
  location PLACE [--name NAME]                a location plate
  prop PROP [--name NAME]                     a key prop
  blocking EP001 seg01                        a blocking reference for a segment
  storyboard EP001 seg01 [--shots "a|b|c"]    a segment's storyboards, line-art and photoreal;
                                              the shots come from the newest breakdown when not given
  take EP001 seg01 [--line TEXT]              a take of a segment (9:16 video with a tone for its sound)
  cut EP001                                   the cut: the newest take of every segment, in order
  status                                      what drama/ holds

The bible and the breakdowns are not drawn: write them yourself in Markdown, at
drama/bible/v1/bible.md and drama/episodes/EP001/breakdown/v1/breakdown.md, with a
"## seg01" heading for each segment followed by its shots as a list.
"""
import argparse
import colorsys
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = "drama"


def hue(name):
    return int(hashlib.sha256(name.encode()).hexdigest()[:4], 16) / 0xFFFF


def rgb(name, light, sat=0.45, shift=0.0):
    r, g, b = colorsys.hls_to_rgb((hue(name) + shift) % 1, light, sat)
    return int(r * 255), int(g * 255), int(b * 255)


def next_version(folder, prefix="v", width=0):
    taken = [int(m.group(1)) for d in (os.listdir(folder) if os.path.isdir(folder) else []) for m in [re.fullmatch(prefix + r"(\d+)", d)] if m]
    n = max(taken, default=0) + 1
    return f"{prefix}{str(n).zfill(width)}"


def newest(folder, prefix="v"):
    found = [(int(m.group(1)), d) for d in (os.listdir(folder) if os.path.isdir(folder) else []) for m in [re.fullmatch(prefix + r"(\d+)", d)] if m]
    return max(found)[1] if found else None


_fonts = {}


def font(size):
    from PIL import ImageFont

    if size in _fonts:
        return _fonts[size]
    paths = []
    if shutil.which("fc-match"):
        for pattern in ("sans-serif:lang=zh-cn", "sans-serif"):
            out = subprocess.run(["fc-match", "-f", "%{file}", pattern], capture_output=True, text=True).stdout.strip()
            if out:
                paths.append(out)
    for path in paths:
        try:
            _fonts[size] = ImageFont.truetype(path, size)
            return _fonts[size]
        except OSError:
            pass
    try:
        _fonts[size] = ImageFont.load_default(size)
    except TypeError:
        _fonts[size] = ImageFont.load_default()
    return _fonts[size]


TOKENS = re.compile(r"[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+")


def wrap(draw, text, size, width):
    lines, line = [], ""
    for token in TOKENS.findall(text):
        trial = line + token
        if line and draw.textlength(trial, font=font(size)) > width:
            lines.append(line.rstrip())
            line = token.lstrip()
        else:
            line = trial
    if line.strip():
        lines.append(line.rstrip())
    return lines


def write(draw, xy, text, size, fill, width=None):
    x, y = xy
    for line in wrap(draw, text, size, width) if width else [text]:
        draw.text((x, y), line, font=font(size), fill=fill)
        y += int(size * 1.3)
    return y


def save(image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, optimize=True)
    print(path)


def figure(draw, x, y, scale, fill, outline):
    r = 14 * scale
    draw.ellipse((x - r, y - r, x + r, y + r), fill=fill, outline=outline, width=max(1, int(2 * scale)))
    draw.polygon(
        [(x - r * 1.4, y + r * 5.5), (x - r * 1.1, y + r * 1.4), (x, y + r * 1.1), (x + r * 1.1, y + r * 1.4), (x + r * 1.4, y + r * 5.5)],
        fill=fill,
        outline=outline,
    )


def look(args):
    from PIL import Image, ImageDraw

    base = os.path.join(ROOT, "assets", "characters", args.character)
    folder = os.path.join(base, "states", args.state) if args.state else base
    version = next_version(folder)
    name = args.name or args.character
    image = Image.new("RGB", (1536, 1024), rgb(name, 0.13, 0.2))
    draw = ImageDraw.Draw(image)
    for i, view in enumerate(("front", "side", "back")):
        figure(draw, 220 + i * 330, 330, 5.5, rgb(name, 0.45 - i * 0.06), rgb(name, 0.8, 0.6))
        draw.text((185 + i * 330, 820), view, font=font(28), fill=(235, 230, 220))
    draw.rounded_rectangle((1130, 160, 1440, 560), 16, fill=rgb(name, 0.22, 0.25))
    draw.ellipse((1185, 240, 1385, 440), fill=rgb(name, 0.45))
    draw.text((1200, 580), "close-up", font=font(28), fill=(235, 230, 220))
    write(draw, (60, 900), f"{name} · {args.state or 'base'} · {version}", 44, (250, 246, 238))
    write(draw, (60, 960), "placeholder look sheet — rehearsal", 26, (200, 196, 188))
    save(image, os.path.join(folder, version, "image-1.png"))


def location(args):
    from PIL import Image, ImageDraw

    folder = os.path.join(ROOT, "assets", "scenes", args.place)
    version = next_version(folder)
    name = args.name or args.place
    image = Image.new("RGB", (1536, 1024), rgb(name, 0.55, 0.3))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 620, 1536, 1024), fill=rgb(name, 0.28, 0.3, 0.05))
    for i in range(6):
        x = 80 + i * 240
        h = 180 + (int(hashlib.sha256(f"{name}{i}".encode()).hexdigest()[:2], 16) % 220)
        draw.rectangle((x, 620 - h, x + 180, 620), fill=rgb(name, 0.2 + i * 0.03, 0.2, 0.5))
        for wy in range(620 - h + 30, 600, 60):
            draw.rectangle((x + 30, wy, x + 70, wy + 30), fill=(240, 220, 160))
    write(draw, (60, 900), f"{name} · {version}", 44, (250, 246, 238))
    write(draw, (60, 960), "placeholder location plate — rehearsal", 26, (235, 230, 220))
    save(image, os.path.join(folder, version, "image-1.png"))


def prop(args):
    from PIL import Image, ImageDraw

    folder = os.path.join(ROOT, "assets", "props", args.prop)
    version = next_version(folder)
    name = args.name or args.prop
    image = Image.new("RGB", (1024, 1024), (236, 230, 218))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((292, 220, 732, 700), 24, fill=rgb(name, 0.55), outline=rgb(name, 0.25), width=8)
    draw.line((292, 380, 732, 540), fill=rgb(name, 0.25), width=6)
    write(draw, (60, 860), f"{name} · {version}", 44, (40, 36, 30))
    write(draw, (60, 920), "placeholder key prop — rehearsal", 26, (90, 84, 76))
    save(image, os.path.join(folder, version, "image-1.png"))


def episode_dir(ep):
    if not re.fullmatch(r"EP\d{3}", ep):
        sys.exit(f"Episode codes look like EP001, not {ep}.")
    return os.path.join(ROOT, "episodes", ep)


def blocking(args):
    from PIL import Image, ImageDraw

    folder = os.path.join(episode_dir(args.episode), "blocking", args.segment)
    version = next_version(folder)
    image = Image.new("RGB", (1024, 1024), (244, 240, 230))
    draw = ImageDraw.Draw(image)
    draw.rectangle((120, 120, 904, 760), outline=(60, 56, 50), width=6)
    for i, (x, y) in enumerate(((330, 420), (640, 360), (520, 600))):
        draw.ellipse((x - 40, y - 40, x + 40, y + 40), fill=rgb(f"{args.segment}{i}", 0.5))
        draw.line((x, y, x + 90, y - 60), fill=(60, 56, 50), width=4)
    draw.polygon(((512, 800), (470, 870), (554, 870)), fill=(60, 56, 50))
    write(draw, (60, 900), f"{args.episode} {args.segment} · blocking · {version}", 36, (40, 36, 30))
    save(image, os.path.join(folder, version, "image-1.png"))


def shots_of(ep, segment):
    """The segment's shots from the newest breakdown, as the studio reads them."""
    base = os.path.join(episode_dir(ep), "breakdown")
    version = newest(base)
    if not version:
        return []
    for name in sorted(os.listdir(os.path.join(base, version))):
        if not name.endswith(".md"):
            continue
        lines = open(os.path.join(base, version, name), encoding="utf-8").read().splitlines()
        named = re.compile(rf"(^|[^\w]){re.escape(segment)}($|[^\w])", re.I)
        start = next((i for i, line in enumerate(lines) if re.match(r"#+\s", line) and named.search(line)), None)
        if start is None:
            continue
        shots = []
        for line in lines[start + 1 :]:
            if re.match(r"#+\s", line):
                break
            text = re.sub(r"^\s*[-*]\s*", "", line).strip()
            if text:
                shots.append(text)
        return shots
    return []


def storyboard(args):
    from PIL import Image, ImageDraw

    shots = [s.strip() for s in args.shots.split("|") if s.strip()] if args.shots else shots_of(args.episode, args.segment)
    shots = shots or [f"Shot {n}" for n in range(1, 5)]
    for style in args.style or ("line-art", "photoreal"):
        folder = os.path.join(episode_dir(args.episode), "multi_panel_storyboard", args.segment, style)
        version = next_version(folder)
        cols = 3 if len(shots) > 4 else 2
        rows = (len(shots) + cols - 1) // cols
        pw, ph, pad = 420, 746, 36
        width, height = cols * pw + (cols + 1) * pad, rows * (ph + 150) + pad + 120
        line_art = style == "line-art"
        image = Image.new("RGB", (width, height), (250, 248, 242) if line_art else (24, 22, 26))
        draw = ImageDraw.Draw(image)
        ink = (30, 28, 26) if line_art else (236, 232, 222)
        write(draw, (pad, 36), f"{args.episode} {args.segment} · {style} · {version} · placeholder", 34, ink)
        for i, shot in enumerate(shots):
            x = pad + (i % cols) * (pw + pad)
            y = 120 + (i // cols) * (ph + 150)
            if line_art:
                draw.rectangle((x, y, x + pw, y + ph), outline=ink, width=4)
            else:
                for band in range(0, ph, 6):
                    draw.rectangle((x, y + band, x + pw, y + band + 6), fill=rgb(f"{args.segment}{i}", 0.18 + 0.3 * band / ph, 0.35))
            figure(draw, x + pw // 2, y + ph // 3, 3.2, None if line_art else rgb(f"{args.segment}{i}", 0.55), ink)
            draw.text((x + 14, y + 10), str(i + 1), font=font(30), fill=ink)
            write(draw, (x, y + ph + 12), shot, 26, ink, pw)
        save(image, os.path.join(folder, version, "image-1.png"))


def ffmpeg(*args):
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is missing on this Computer.")
    done = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if done.returncode:
        sys.exit(done.stderr.strip() or "ffmpeg failed")


def take(args):
    from PIL import Image, ImageDraw

    folder = os.path.join(episode_dir(args.episode), "segments", args.segment)
    number = next_version(folder, "t", 2)
    seconds = args.seconds
    frame = Image.new("RGB", (480, 854), rgb(args.segment + args.episode, 0.22, 0.35))
    draw = ImageDraw.Draw(frame)
    figure(draw, 240, 300, 3.4, rgb(args.segment, 0.55), (240, 236, 228))
    write(draw, (32, 40), f"{args.episode} {args.segment} · {number}", 30, (250, 246, 238))
    write(draw, (32, 84), "placeholder take — rehearsal", 20, (210, 206, 198))
    if args.line:
        write(draw, (32, 640), args.line, 26, (250, 246, 238), 416)
    out = os.path.join(folder, number, "video.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        still = os.path.join(tmp, "frame.png")
        frame.save(still)
        tone = 220 + int(hue(args.segment) * 440)
        ffmpeg(
            "-loop", "1", "-framerate", "24", "-i", still,
            "-f", "lavfi", "-i", f"sine=frequency={tone}:sample_rate=44100:duration={seconds}",
            "-vf", f"drawbox=x=0:y=ih-10:w=iw*t/{seconds}:h=10:color=white@0.85:t=fill,format=yuv420p",
            "-t", str(seconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
            "-c:a", "aac", "-b:a", "64k", "-af", "volume=0.15", "-movflags", "+faststart", "-shortest", out,
        )
    print(out)


def cut(args):
    base = os.path.join(episode_dir(args.episode), "segments")
    segments = sorted((d for d in (os.listdir(base) if os.path.isdir(base) else []) if re.fullmatch(r"seg\d+[a-z]?", d)), key=lambda d: (int(re.sub(r"\D", "", d)), d))
    takes = [os.path.join(base, seg, newest(os.path.join(base, seg), "t"), "video.mp4") for seg in segments if newest(os.path.join(base, seg), "t")]
    takes = [path for path in takes if os.path.exists(path)]
    if not takes:
        sys.exit(f"{args.episode} has no takes yet.")
    folder = os.path.join(episode_dir(args.episode), "edit")
    version = next_version(folder)
    out = os.path.join(folder, version, "cut.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as listing:
        listing.write("".join(f"file '{os.path.abspath(path)}'\n" for path in takes))
    try:
        ffmpeg("-f", "concat", "-safe", "0", "-i", listing.name, "-c", "copy", "-movflags", "+faststart", out)
    finally:
        os.unlink(listing.name)
    print(out)


def status(_args):
    if not os.path.isdir(ROOT):
        print("drama/ is empty.")
        return
    for folder, dirs, files in sorted(os.walk(ROOT)):
        dirs.sort()
        for name in sorted(files):
            print(os.path.join(folder, name))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("look")
    p.add_argument("character")
    p.add_argument("--state")
    p.add_argument("--name")
    p.set_defaults(run=look)
    p = sub.add_parser("location")
    p.add_argument("place")
    p.add_argument("--name")
    p.set_defaults(run=location)
    p = sub.add_parser("prop")
    p.add_argument("prop")
    p.add_argument("--name")
    p.set_defaults(run=prop)
    p = sub.add_parser("blocking")
    p.add_argument("episode")
    p.add_argument("segment")
    p.set_defaults(run=blocking)
    p = sub.add_parser("storyboard")
    p.add_argument("episode")
    p.add_argument("segment")
    p.add_argument("--shots")
    p.add_argument("--style", action="append", choices=("line-art", "photoreal"))
    p.set_defaults(run=storyboard)
    p = sub.add_parser("take")
    p.add_argument("episode")
    p.add_argument("segment")
    p.add_argument("--line")
    p.add_argument("--seconds", type=float, default=4)
    p.set_defaults(run=take)
    p = sub.add_parser("cut")
    p.add_argument("episode")
    p.set_defaults(run=cut)
    p = sub.add_parser("status")
    p.set_defaults(run=status)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
