Run desktop\scripts\fetch-ffmpeg.ps1 to provision the pinned engineering build so this folder contains:

  ffmpeg.exe
  ffprobe.exe
  LICENSE-FFMPEG.txt

The current engineering bundle is BtbN's Windows x64 LGPL build from 2026-07-18.
The fetch script validates the resulting executable hashes before accepting an updated download.
The packaging build includes this directory under resources\ffmpeg.
