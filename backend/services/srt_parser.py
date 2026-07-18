import re


def time_to_seconds(time_str):

    hours, minutes, seconds = time_str.split(":")

    seconds = seconds.replace(",", ".")

    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def parse_srt(file_path):

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read().replace("\r\n", "\n").replace("\r", "\n")

    segments = []

    for block in re.split(r"\n\s*\n", content):
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if len(lines) < 2:
            continue
        time_line_index = 1 if re.fullmatch(r"\d+", lines[0]) else 0
        if time_line_index >= len(lines) or "-->" not in lines[time_line_index]:
            continue
        start_raw, end_raw = [part.strip() for part in lines[time_line_index].split("-->", 1)]
        text_lines = lines[time_line_index + 1 :]
        if not text_lines:
            continue
        segments.append(
            {
                "start": time_to_seconds(start_raw),
                "end": time_to_seconds(end_raw),
                "text": " ".join(text_lines).strip(),
            }
        )

    return segments
