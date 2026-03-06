#!/usr/bin/env python3
"""Generate CEO Dashboard app icon as a 1024x1024 PNG.

Black-to-dark-gray radial gradient background with rounded corners,
Claude star symbol centered with ~30% padding on each side.
"""
import struct
import zlib
import math
import os
import sys

SIZE = 1024
CORNER_RADIUS = int(SIZE * 0.22)  # macOS-style rounded corners

# Claude star color — dashboard accent (default: gold)
# Override with --color RRGGBB (hex, no #)
STAR_R, STAR_G, STAR_B = 0xC9, 0xA8, 0x4C

# Background color — dashboard base bg (default: #121212)
# Override with --bg RRGGBB (hex, no #)
BG_R, BG_G, BG_B = 0x12, 0x12, 0x12
BG_CUSTOM = False

for i, arg in enumerate(sys.argv):
    if arg == "--color" and i + 1 < len(sys.argv):
        h = sys.argv[i + 1].lstrip("#")
        if len(h) == 6:
            STAR_R, STAR_G, STAR_B = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    elif arg == "--bg" and i + 1 < len(sys.argv):
        h = sys.argv[i + 1].lstrip("#")
        if len(h) == 6:
            BG_R, BG_G, BG_B = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            BG_CUSTOM = True

# Parse the Claude star SVG path into line segments for rasterization
# The path data from claude-symbol.svg (viewBox 0 0 1200 1200)
PATH_DATA = "M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 0.000033 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 L 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z"


def parse_path(d):
    """Parse SVG path into list of (x, y) points."""
    points = []
    tokens = d.replace(",", " ").split()
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in ("M", "L", "Z"):
            i += 1
            continue
        try:
            x = float(t)
            y = float(tokens[i + 1])
            points.append((x, y))
            i += 2
        except (ValueError, IndexError):
            i += 1
    return points


def point_in_polygon(x, y, polygon):
    """Ray casting algorithm."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def in_rounded_rect(x, y, w, h, r):
    """Check if point is inside a rounded rectangle."""
    if r <= 0:
        return 0 <= x <= w and 0 <= y <= h
    # Interior rectangles (no rounding needed)
    if r <= x <= w - r and 0 <= y <= h:
        return True
    if 0 <= x <= w and r <= y <= h - r:
        return True
    # Corner circles
    corners = [(r, r), (w - r, r), (r, h - r), (w - r, h - r)]
    for cx, cy in corners:
        if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
            return True
    return False


def make_png(width, height, pixels):
    """Create a PNG file from RGBA pixel data."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    raw = b""
    for y in range(height):
        raw += b"\x00"  # filter byte
        row_start = y * width * 4
        raw += pixels[row_start : row_start + width * 4]

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(raw, 9))
    iend = chunk(b"IEND", b"")
    return header + ihdr + idat + iend


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ceo-dashboard-icon.png"

    # Parse star polygon in SVG space (0-1200)
    star_poly = parse_path(PATH_DATA)

    # Star bounding box in SVG space
    xs = [p[0] for p in star_poly]
    ys = [p[1] for p in star_poly]
    sx_min, sx_max = min(xs), max(xs)
    sy_min, sy_max = min(ys), max(ys)
    star_w = sx_max - sx_min
    star_h = sy_max - sy_min

    # Place star centered with ~22% padding
    padding = 0.22
    avail = SIZE * (1 - 2 * padding)
    scale = avail / max(star_w, star_h)
    offset_x = (SIZE - star_w * scale) / 2 - sx_min * scale
    offset_y = (SIZE - star_h * scale) / 2 - sy_min * scale

    # Transform polygon to pixel space
    star_px = [(p[0] * scale + offset_x, p[1] * scale + offset_y) for p in star_poly]

    # Precompute star bounding box in pixel space
    pxs = [p[0] for p in star_px]
    pys = [p[1] for p in star_px]
    star_px_xmin = int(min(pxs)) - 1
    star_px_xmax = int(max(pxs)) + 2
    star_px_ymin = int(min(pys)) - 1
    star_px_ymax = int(max(pys)) + 2

    # Shadow: offset star polygon down and right slightly
    shadow_dx, shadow_dy = 6, 10
    shadow_px = [(px + shadow_dx, py + shadow_dy) for px, py in star_px]
    shadow_blur = 18  # how far the shadow extends beyond the shape

    # Background gradient: slightly brighter center → bg color at edges
    # Keeps the chosen bg color prominent across the entire icon
    center_r = min(255, int(BG_R * 1.35))
    center_g = min(255, int(BG_G * 1.35))
    center_b = min(255, int(BG_B * 1.35))
    edge_r = max(0, int(BG_R * 0.65))
    edge_g = max(0, int(BG_G * 0.65))
    edge_b = max(0, int(BG_B * 0.65))
    cx, cy = SIZE / 2, SIZE / 2
    max_dist = math.sqrt(cx * cx + cy * cy)

    # Star gradient: lighter top → deeper bottom (derived from accent color)
    star_top_r = min(255, int(STAR_R * 1.1))
    star_top_g = min(255, int(STAR_G * 1.1))
    star_top_b = min(255, int(STAR_B * 1.1))
    star_bot_r = int(STAR_R * 0.82)
    star_bot_g = int(STAR_G * 0.82)
    star_bot_b = int(STAR_B * 0.82)

    # Precompute a shadow mask using multi-sample distance field
    # For performance, compute star coverage at each pixel first
    print("Generating icon...", flush=True)

    # Pass 1: compute star alpha for each pixel (used for shadow blur)
    star_alpha = bytearray(SIZE * SIZE)
    for y in range(max(0, star_px_ymin), min(SIZE, star_px_ymax + 1)):
        for x in range(max(0, star_px_xmin), min(SIZE, star_px_xmax + 1)):
            hits = 0
            for ssy in range(4):
                for ssx in range(4):
                    if point_in_polygon(x + (ssx + 0.5) / 4, y + (ssy + 0.5) / 4, star_px):
                        hits += 1
            if hits > 0:
                star_alpha[y * SIZE + x] = int(hits / 16.0 * 255)

    # Pass 2: compute shadow alpha (blurred offset of star)
    shadow_alpha_map = bytearray(SIZE * SIZE)
    shadow_expand = shadow_blur + max(abs(shadow_dx), abs(shadow_dy)) + 2
    sy_min_px = max(0, star_px_ymin - shadow_expand)
    sy_max_px = min(SIZE, star_px_ymax + shadow_expand + 1)
    sx_min_px = max(0, star_px_xmin - shadow_expand)
    sx_max_px = min(SIZE, star_px_xmax + shadow_expand + 1)

    for y in range(sy_min_px, sy_max_px):
        for x in range(sx_min_px, sx_max_px):
            # Sample the star_alpha at the un-offset position
            src_x = x - shadow_dx
            src_y = y - shadow_dy
            if 0 <= src_x < SIZE and 0 <= src_y < SIZE:
                a = star_alpha[src_y * SIZE + src_x]
                if a > 0:
                    # Simple box blur approximation: just use the alpha with distance falloff
                    shadow_alpha_map[y * SIZE + x] = a

    # Quick 2-pass box blur on shadow_alpha_map for soft shadow
    for _pass in range(3):
        tmp = bytearray(SIZE * SIZE)
        r = 6  # blur radius
        for y in range(sy_min_px, sy_max_px):
            acc = 0
            count = 0
            for x in range(max(0, sx_min_px - r), min(SIZE, sx_max_px + r)):
                acc += shadow_alpha_map[y * SIZE + x]
                count += 1
                if count > 2 * r + 1:
                    acc -= shadow_alpha_map[y * SIZE + (x - 2 * r - 1)]
                    count -= 1
                if x >= sx_min_px:
                    tmp[y * SIZE + x] = min(255, acc // max(count, 1))
        for x in range(sx_min_px, sx_max_px):
            acc = 0
            count = 0
            for y2 in range(max(0, sy_min_px - r), min(SIZE, sy_max_px + r)):
                acc += tmp[y2 * SIZE + x]
                count += 1
                if count > 2 * r + 1:
                    acc -= tmp[(y2 - 2 * r - 1) * SIZE + x]
                    count -= 1
                if y2 >= sy_min_px:
                    shadow_alpha_map[y2 * SIZE + x] = min(255, acc // max(count, 1))

    # Pass 3: composite everything
    pixels = bytearray(SIZE * SIZE * 4)
    for y in range(SIZE):
        for x in range(SIZE):
            idx = (y * SIZE + x) * 4

            if not in_rounded_rect(x, y, SIZE - 1, SIZE - 1, CORNER_RADIUS):
                pixels[idx:idx+4] = b"\x00\x00\x00\x00"
                continue

            # Radial gradient background
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            t = min(dist / max_dist, 1.0)
            t = t * t  # ease
            bg_r = int(center_r + (edge_r - center_r) * t)
            bg_g = int(center_g + (edge_g - center_g) * t)
            bg_b = int(center_b + (edge_b - center_b) * t)

            # Composite shadow onto background
            sa = shadow_alpha_map[y * SIZE + x] / 255.0 * 0.5  # 50% opacity shadow
            if sa > 0:
                bg_r = int(bg_r * (1 - sa))
                bg_g = int(bg_g * (1 - sa))
                bg_b = int(bg_b * (1 - sa))

            # Composite star with vertical gradient
            a = star_alpha[y * SIZE + x]
            if a > 0:
                alpha = a / 255.0
                # Vertical gradient on star: top to bottom
                gy = (y - star_px_ymin) / max(star_px_ymax - star_px_ymin, 1)
                sr = int(star_top_r + (star_bot_r - star_top_r) * gy)
                sg = int(star_top_g + (star_bot_g - star_top_g) * gy)
                sb = int(star_top_b + (star_bot_b - star_top_b) * gy)
                bg_r = int(bg_r * (1 - alpha) + sr * alpha)
                bg_g = int(bg_g * (1 - alpha) + sg * alpha)
                bg_b = int(bg_b * (1 - alpha) + sb * alpha)

            pixels[idx] = max(0, min(255, bg_r))
            pixels[idx+1] = max(0, min(255, bg_g))
            pixels[idx+2] = max(0, min(255, bg_b))
            pixels[idx+3] = 255

    png_data = make_png(SIZE, SIZE, bytes(pixels))
    with open(out_path, "wb") as f:
        f.write(png_data)
    print(f"Icon saved to {out_path} ({len(png_data)} bytes)")


if __name__ == "__main__":
    main()
