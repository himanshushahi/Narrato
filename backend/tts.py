import os
import re
import wave
import uuid
from pathlib import Path
import shutil

from huggingface_hub import hf_hub_download
from piper import PiperVoice
from piper.config import SynthesisConfig

from backend.core.config import get_models_dir, get_temp_dir
from backend.core.logger import logger

def get_piper_dir() -> Path:
    piper_dir = get_models_dir() / "piper"
    piper_dir.mkdir(parents=True, exist_ok=True)
    return piper_dir

def download_piper_voice(voice_id: str) -> dict:
    """
    Downloads Piper models dynamically from HuggingFace.
    voice_id format: lang_region-speaker (e.g., hi_IN-swara, en_US-lessac)
    Defaults to 'medium' quality.
    """
    quality = "medium"
    full_voice_id = f"{voice_id}-{quality}"
    parts = full_voice_id.split('-')
    
    # Handle potentially malformed IDs (fallback)
    if len(parts) < 3:
        logger.error(f"Invalid voice ID format: {full_voice_id}. Expected lang_region-speaker-quality")
        raise ValueError(f"Invalid voice ID format: {full_voice_id}")

    lang_region = parts[0]
    lang = lang_region.split('_')[0]
    speaker = parts[1]
    
    subfolder = f"{lang}/{lang_region}/{speaker}/{quality}"
    output_dir = get_piper_dir()
    
    fid = f"{voice_id}-{quality}"
    sfold = f"{lang}/{lang_region}/{speaker}/{quality}"
    m_path = output_dir / f"{fid}.onnx"
    c_path = output_dir / f"{fid}.onnx.json"
    
    if m_path.exists() and c_path.exists():
        return {"status": "success", "model_path": str(m_path), "config_path": str(c_path), "quality": quality}
        
    logger.info(f"Downloading Piper voice: {fid} from {sfold}...")
    try:
        hf_model = hf_hub_download(repo_id="rhasspy/piper-voices", filename=f"{sfold}/{fid}.onnx")
        import shutil
        shutil.copy(hf_model, m_path)
        
        hf_config = hf_hub_download(repo_id="rhasspy/piper-voices", filename=f"{sfold}/{fid}.onnx.json")
        shutil.copy(hf_config, c_path)
        
        logger.info(f"Successfully downloaded {fid}")
        return {"status": "success", "model_path": str(m_path), "config_path": str(c_path), "quality": quality}
    except Exception as e:
        logger.error(f"Failed to download piper voice {voice_id}: {e}")
        return {"status": "error", "message": str(e)}

def check_piper_voice(voice_id: str) -> bool:
    """Checks if a Piper voice is already downloaded."""
    quality = "medium"
    fid = f"{voice_id}-{quality}"
    output_dir = get_piper_dir()
    m_path = output_dir / f"{fid}.onnx"
    c_path = output_dir / f"{fid}.onnx.json"
    return m_path.exists() and c_path.exists()

def delete_piper_voice(voice_id: str) -> bool:
    """Deletes a downloaded Piper voice."""
    quality = "medium"
    fid = f"{voice_id}-{quality}"
    output_dir = get_piper_dir()
    m_path = output_dir / f"{fid}.onnx"
    c_path = output_dir / f"{fid}.onnx.json"
    
    deleted = False
    try:
        if m_path.exists():
            m_path.unlink()
            deleted = True
        if c_path.exists():
            c_path.unlink()
            deleted = True
        return deleted
    except Exception as e:
        logger.error(f"Failed to delete piper voice {voice_id}: {e}")
        return False

def _chunk_text(text: str, lang: str = "en") -> list[str]:
    """
    Splits text into chunks to prevent TTS engine from crashing on long sequences.
    For CJK languages, split by character chunks. 
    For others, split by sentences/clauses.
    """
    cjk_langs = ["ja", "zh", "ko"]
    is_cjk = any(lang.startswith(l) for l in cjk_langs)
    
    if is_cjk:
        # Chunk by roughly 30-40 characters
        chunk_size = 40
        return [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
    else:
        # Split by punctuation (., !, ?) then combine small ones if needed
        # Simple implementation: split by punctuation and keep it
        sentences = re.split(r'([.!?]+)', text)
        chunks = []
        current_chunk = ""
        
        for i in range(0, len(sentences)-1, 2):
            sentence = sentences[i]
            punct = sentences[i+1]
            part = (sentence + punct).strip()
            
            if len(current_chunk.split()) + len(part.split()) < 20:
                current_chunk += " " + part if current_chunk else part
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = part
                
        # Add remaining part
        if len(sentences) % 2 != 0:
            part = sentences[-1].strip()
            if current_chunk:
                current_chunk += " " + part
            else:
                current_chunk = part
                
        if current_chunk:
            chunks.append(current_chunk.strip())
            
        return chunks if chunks else [text]

def generate_tts(text: str, voice_id: str, speed: float = 1.0) -> str:
    """
    Generates TTS audio, chunking if necessary, and returns the path to the output .wav file.
    """
    quality = "medium"
    full_voice_id = f"{voice_id}-{quality}"
    model_path = get_piper_dir() / f"{full_voice_id}.onnx"
    
    if not model_path.exists():
        logger.info(f"Model for {voice_id} not found, downloading...")
        res = download_piper_voice(voice_id)
        if res.get("status") != "success":
            raise Exception(f"Failed to obtain model: {res.get('message')}")
        model_path = Path(res.get("model_path"))
            
    # Language detection for chunking
    lang = full_voice_id.split('_')[0]
    chunks = _chunk_text(text, lang)
    
    logger.info(f"Synthesizing {len(chunks)} chunks with Piper ({full_voice_id})...")
    
    piper_voice = PiperVoice.load(str(model_path))
    
    # Piper uses length_scale for speed control. Lower length_scale = faster speech.
    config = SynthesisConfig(length_scale=1.0 / speed)
    
    temp_dir = get_temp_dir()
    chunk_files = []
    
    try:
        for i, chunk in enumerate(chunks):
            if not chunk.strip():
                continue
            chunk_file = temp_dir / f"chunk_{uuid.uuid4().hex}_{i}.wav"
            with wave.open(str(chunk_file), 'wb') as wav_file:
                piper_voice.synthesize_wav(chunk, wav_file, syn_config=config)
            chunk_files.append(chunk_file)
            
        # Concatenate chunk files
        output_file = temp_dir / f"piper_tts_{uuid.uuid4().hex}.wav"
        if not chunk_files:
            raise Exception("No valid text to synthesize")
            
        with wave.open(str(output_file), 'wb') as out_wav:
            with wave.open(str(chunk_files[0]), 'rb') as first_wav:
                out_wav.setparams(first_wav.getparams())
                out_wav.writeframes(first_wav.readframes(first_wav.getnframes()))
                
            for chunk_file in chunk_files[1:]:
                with wave.open(str(chunk_file), 'rb') as ch_wav:
                    out_wav.writeframes(ch_wav.readframes(ch_wav.getnframes()))
                    
        return str(output_file)
    finally:
        # Cleanup chunks
        for chunk_file in chunk_files:
            if chunk_file.exists():
                try:
                    os.remove(chunk_file)
                except Exception as e:
                    logger.warning(f"Could not remove temp chunk file {chunk_file}: {e}")
