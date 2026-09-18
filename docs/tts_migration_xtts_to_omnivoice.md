# TTS Migration: XTTS v2 -> OmniVoice

Status: implemented on branch `feature/tts_migration` (backend + frontend).
Scope: English + Hindi voice cloning for `remotion_canvas`.
Proposed replacement: https://github.com/k2-fsa/OmniVoice Python API (`k2-fsa/OmniVoice` on Hugging Face).

## 1. Why migrate

Current XTTS v2 cloning quality is not good enough, especially Hindi.
OmniVoice is newer (2026, diffusion LM-style, 0.6B params), SOTA-claimed for voice cloning, naturalness, intelligibility, and supports 600+ languages including `en` and `hi` in one unified model.

No need to load separate per-language models. English + Hindi requirement is fully covered.

## 2. Comparison

| Criteria | XTTS v2 (current) | OmniVoice (proposed) |
|---|---|---|
| Params | ~1.7B total system (GPT + CLVP + decoder) | 0.6B backbone (Qwen3-0.6B based) + Higgs acoustic tokenizer, ~0.8B full system |
| Disk / download | ~1.8-2.0GB | ~3.3GB (`model.safetensors` 2.45GB + `audio_tokenizer/model.safetensors` ~806MB + tokenizer JSON). User estimate of 1.3-2.5GB is low. + optional Whisper weights if using auto-transcription |
| VRAM (practical) | FP16 ~2-3.4GB weights, ~4-6GB working, 8GB recommended | FP16 ~4GB working envelope, comfortable on 8-12GB. CPU-offload path reported at ~1.3GB GPU + 2.4GB RAM |
| Speed | Autoregressive, RTF ~0.15-0.25 (~4-10x real-time). Needs sentence splitting, optional DeepSpeed, streaming first-chunk ~200ms but slower overall | Non-autoregressive diffusion, RTF as low as 0.025 (40x real-time). FlashInfer path 0.0115 RTF at batch 8. Much faster batch / long text |
| Languages | 17 (includes `en`, `hi`) | 646 (includes `en` 206k hrs, `hi` 117 hrs training data) |
| Hindi quality | Weak, often flat/robotic, poor similarity. This is the main complaint now | Strong per paper: Hindi WER 4.33 vs MiniMax 6.96 vs ElevenLabs 5.82, SIM-o 0.863 vs 0.818 vs 0.73 |
| English quality | Good but dated vs 2026 models | SOTA on LibriSpeech-PC / Seed-TTS in paper (SIM-o, WER, UTMOS) |
| Voice cloning input | ~6s speaker_wav + `language_idx` required | 3-10s `ref_audio` + optional `ref_text`. If omitted, Whisper auto-transcribes. Same-language ref recommended |
| Extra features | Cross-lingual cloning, streaming, fine-tune support | Voice design (gender/age/pitch/accent, no audio needed), `[laughter]/[sigh]` tags, pinyin/CMU pronunciation override, `speed`/`duration`/`num_step` controls, batch multi-GPU CLI |
| Setup | `coqui-TTS` package, old pins, Python version issues, `language_idx`, `gpt_cond_latent` caching | `pip install omnivoice` + torch, `OmniVoice.from_pretrained(...)`, `generate(...)`, Gradio demo, Colab, `uv` support, CUDA/MPS/XPU |
| License | Coqui Public Model License (check commercial limits) | Code Apache-2.0, weights CC-BY-NC (due to Emilia data). Both non-commercial, fine for personal/research |

## 3. What changes for English + Hindi

1. No `language_idx` needed. OmniVoice auto-handles language from text.
2. Use same-language reference for best accent: Hindi ref -> Hindi output, English ref -> English output. Cross-lingual works but carries source accent.
3. Reference length sweet spot 3-10s. Longer does not help, slows inference and can hurt quality.
4. Normalize numbers before synthesis (`123` -> `one hundred twenty-three`). OmniVoice has opt-in `normalize_text` via `omnivoice[tn]`; other languages fall back to `num2words`.
5. Output is 24kHz mono `np.ndarray`, same as XTTS v2, so downstream Remotion / file-server path should not change.

## 4. Python API shape (for later implementation)

No code yet. When implementing, target this surface from upstream README:

- Load: `OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda:0", dtype=torch.float16)`
- Clone: `generate(text=..., ref_audio=..., ref_text=...)`
- Reuse voice: `create_voice_clone_prompt(...)` -> `save("my_voice.pt")` -> `VoiceClonePrompt.load(...)` for repeat speakers (avoids re-encoding + Whisper each call)
- Design (optional): `generate(text=..., instruct="female, low pitch, ...")`
- Auto (optional): `generate(text=...)`
- Perf knobs: `num_step` (32 quality / 16 fast), `speed`, `duration`, optional FlashInfer for batch

CLI equivalents exist: `omnivoice-demo`, `omnivoice-infer`, `omnivoice-infer-batch`.

## 5. Migration checklist

Implementation notes (branch `feature/tts_migration`):
- Backend: new `backend/omnivoice_tts.py` (model cache, snapshot download,
  voice-prompt cache, chunking, number normalization); `backend/xtts.py` compat
  shim was removed after the migration (no importers left);
  `backend/pipeline/tts.py` + `backend/core/bridge.py` accept
  engine `"xtts"` (legacy id) and `"omnivoice"` (alias); `omnivoice>=0.2.1`
  added to requirements. Engine id `"xtts"` is kept in settings/DB (no data
  migration); UI displays "OmniVoice".
- Frontend: labels/badges/hints switched from "XTTS v2" to "OmniVoice"
  (`SettingsPage.tsx`, `VoiceTab.tsx`); download size text ~1.8GB -> ~3.3GB;
  reference hint 6-15s -> 3-10s; bridge exposes `check/start/delete_omnivoice_*`
  only (old `xtts_*` duplicates removed).

- [x] Add `omnivoice` as optional TTS backend behind existing TTS interface, keep XTTS as fallback
- [x] Cache model once per process, support `float16` on CUDA, `mps`/`xpu` note
- [x] Implement voice-prompt cache (`VoiceClonePrompt.save/load`) per speaker ID
- [x] Always pass `ref_text` when known to avoid Whisper download; allow auto-transcribe fallback
  (implemented via local faster-whisper: reference clips are transcribed with
  `models/whisper/turbo` when present, otherwise faster-whisper "turbo" is
  bootstrap-downloaded once via the existing whisper download machinery
  (serialized, cancellable); all model paths resolve via `get_models_dir()`,
  dynamic per dev/prod. OmniVoice's own ~1.6GB transformers Whisper download
  is only a last resort when no local model exists)
- [x] Text chunking: OmniVoice is faster so larger chunks are OK, but keep sentence split for very long scripts
- [x] Number normalization step before `generate`
- [ ] Verify Hindi samples (Devanagari) + English samples with same cloned voice
- [ ] Measure RTF / VRAM on target GPU, decide `num_step=16 vs 32`
- [x] Update requirements / docs, note ~3.3GB first-run download + HF cache location
- [ ] Test offline behavior and `HF_ENDPOINT` mirror if needed

## 6. Risks / open questions

- New repo (63 commits, heavy 2026 activity) - API may shift. Pin version when implementing.
- CC-BY-NC weights - confirm OK for this project's distribution.
- Whisper auto-transcription adds download + latency - prefer explicit `ref_text`.
- Voice design mode is English/Chinese-trained; stick to voice cloning for Hindi stability.
- FlashInfer is optional NVIDIA-only speedup; not required for v1.

## References

- https://github.com/k2-fsa/OmniVoice
- https://huggingface.co/k2-fsa/OmniVoice
- Paper: arXiv 2604.00688 `OmniVoice: Towards Omnilingual Zero-Shot Text-to-Speech with Diffusion Language Models`
- Demo paper page with Hindi `hi` (`117.17` hrs) and English `en` language list: `docs/languages.md` upstream
