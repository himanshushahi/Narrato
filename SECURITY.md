# Security & Privacy Policy

## Supported Versions

We actively maintain and provide security updates for the latest major and minor releases of Narrato.

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## Local-First Privacy Pledge

Narrato is architected from the ground up as a **local-first desktop studio**:
- **Zero Cloud Telemetry**: Narrato does not phone home, track usage, or report analytics to any third-party telemetry servers.
- **Local Credentials**: Any API keys you supply (e.g., OpenAI, OpenRouter, LangSearch, Pexels, HuggingFace tokens) are stored exclusively in your local SQLite database (`storage/narrato.db`) or `%LOCALAPPDATA%\Narrato\storage\narrato.db`. They are never sent anywhere except the respective official API endpoints you configure.
- **Offline Capable**: Audio synthesis (DhVaani voice cloning), transcription (Faster-Whisper), Remotion rendering, and SQLite database run completely offline on your local CPU / GPU.

---

## Reporting a Vulnerability

If you discover a security vulnerability or sensitive information disclosure in Narrato, please **do not open a public GitHub issue**.

Instead, please send an email directly to:
**himanshushahi0478@gmail.com** with the subject `[SECURITY VULNERABILITY] Narrato`.

Please include in your report:
1. A description of the issue and its potential impact.
2. Step-by-step reproduction instructions or proof-of-concept code.
3. Your operating system, Python version, and Narrato version.
4. Any proposed remediations or patches if you have them.

We will acknowledge receipt of your vulnerability report within 48 hours and work with you to patch and release a fix as quickly as possible.
