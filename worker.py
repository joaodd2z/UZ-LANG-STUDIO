# Copyright — todos os direitos reservados a Henrique
import os
import time
import tempfile
import subprocess
import json
from datetime import datetime

from google.cloud import firestore, storage
from dotenv import load_dotenv
import requests

load_dotenv()

PROJECT_ID = os.getenv('FIREBASE_PROJECT_ID') or os.getenv('GOOGLE_CLOUD_PROJECT')
TTS_ENABLED = os.getenv('TTS_ENABLED', 'false').lower() == 'true'
TRANSLATE_PROVIDER = os.getenv('TRANSLATE_PROVIDER', 'deepl')
TRANSLATE_API_KEY = os.getenv('TRANSLATE_API_KEY')
TTS_PROVIDER = os.getenv('TTS_PROVIDER', 'eleven')
TTS_API_KEY = os.getenv('TTS_API_KEY')
TTS_VOICE_ID = os.getenv('TTS_VOICE_ID', 'blast')

if not PROJECT_ID:
    raise RuntimeError('Defina FIREBASE_PROJECT_ID para o worker')

fs = firestore.Client(project=PROJECT_ID)
st = storage.Client(project=PROJECT_ID)

bucket_name = os.getenv('FIREBASE_STORAGE_BUCKET')
if not bucket_name:
    raise RuntimeError('Defina FIREBASE_STORAGE_BUCKET (ex.: your-project.appspot.com)')

bucket = st.bucket(bucket_name)


def log(job_ref, message):
    print(f"[{datetime.utcnow().isoformat()}] {message}")
    job_ref.update({
        'log': firestore.ArrayUnion([message]),
        'updatedAt': firestore.SERVER_TIMESTAMP
    })


def set_status(job_ref, status, step=None):
    patch = {'status': status, 'updatedAt': firestore.SERVER_TIMESTAMP}
    if step:
        patch['currentStep'] = step
    job_ref.update(patch)


def youtube_audio_to_wav(youtube_id, out_wav):
    with tempfile.TemporaryDirectory() as tmp:
        out_mp3 = os.path.join(tmp, 'audio.mp3')
        url = f"https://www.youtube.com/watch?v={youtube_id}"
        cmd_ytdlp = ["yt-dlp", "-f", "bestaudio/best", "-x", "--audio-format", "mp3", "-o", out_mp3, url]
        subprocess.check_call(cmd_ytdlp)
        cmd_ff = ["ffmpeg", "-y", "-i", out_mp3, "-ac", "1", "-ar", "16000", out_wav]
        subprocess.check_call(cmd_ff)


def transcribe_wav_to_srt_pt(wav_path, srt_path):
    # Faster-Whisper transcrição
    from faster_whisper import WhisperModel
    model_size = "small"  # balance CPU usage
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(wav_path, language="pt", beam_size=1)

    def format_time(t):
        h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60); ms = int((t - int(t)) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    with open(srt_path, 'w', encoding='utf-8') as f:
        for i, seg in enumerate(segments, start=1):
            f.write(f"{i}\n")
            f.write(f"{format_time(seg.start)} --> {format_time(seg.end)}\n")
            f.write(seg.text.strip()+"\n\n")


def translate_srt(src_srt, target_lang, out_srt):
    lines = open(src_srt, 'r', encoding='utf-8').read().splitlines()
    # Very simple translation stub if no provider key
    if not TRANSLATE_API_KEY:
        with open(out_srt, 'w', encoding='utf-8') as f:
            for ln in lines:
                f.write(ln.replace('-->','-->')+"\n")
        return
    # Example: DeepL API (free/pro)
    if TRANSLATE_PROVIDER == 'deepl':
        url = 'https://api-free.deepl.com/v2/translate'
        headers = { 'Authorization': f'DeepL-Auth-Key {TRANSLATE_API_KEY}' }
        def translate(text):
            resp = requests.post(url, data={'text': text, 'target_lang': target_lang.upper()}, headers=headers, timeout=60)
            resp.raise_for_status()
            return resp.json()['translations'][0]['text']
    else:
        # TODO: implement gcloud/azure
        def translate(text):
            return text

    # naive parsing: translate only text lines (no index or timecode)
    out_lines = []
    for ln in lines:
        if ln.strip().isdigit() or "-->" in ln or not ln.strip():
            out_lines.append(ln)
        else:
            out_lines.append(translate(ln))
    open(out_srt, 'w', encoding='utf-8').write("\n".join(out_lines))


def tts_stub(text, out_mp3, lang):
    # Fallback de desenvolvimento: gera MP3 de silêncio (3s) para não quebrar a UI
    try:
        # 3 segundos de áudio silencioso em MP3
        subprocess.check_call(["ffmpeg","-y","-f","lavfi","-i","anullsrc=r=44100:cl=mono","-t","3","-q:a","9","-acodec","libmp3lame", out_mp3])
    except Exception:
        # Fallback mínimo caso ffmpeg falhe
        with open(out_mp3, 'wb') as f:
            f.write(b"\x49\x44\x33")  # cabeçalho ID3 simplificado (não garante player)


def srt_to_plaintext(srt_path):
    # simple extract text
    out = []
    for ln in open(srt_path, 'r', encoding='utf-8'):
        if ln.strip().isdigit() or "-->" in ln or not ln.strip():
            continue
        out.append(ln.strip())
    return "\n".join(out)


def exists_in_storage(path):
    emulator = os.getenv('FIREBASE_STORAGE_EMULATOR_HOST')
    if emulator:
        r = requests.get(f"http://{emulator}/v0/b/{bucket_name}/o/{path}")
        return r.status_code == 200
    return bucket.blob(path).exists()


def upload_file(local_path, dest):
    emulator = os.getenv('FIREBASE_STORAGE_EMULATOR_HOST')
    if emulator:
        # Upload via API JSON do emulador de Storage
        url = f"http://{emulator}/v0/b/{bucket_name}/o?uploadType=media&name={dest}"
        with open(local_path, 'rb') as f:
            data = f.read()
        r = requests.post(url, data=data, headers={'Content-Type': 'application/octet-stream'})
        if r.status_code >= 400:
            raise RuntimeError(f"Falha upload emulador: {r.status_code} {r.text}")
        return
    # Upload via cliente GCS (produção)
    blob = bucket.blob(dest)
    blob.upload_from_filename(local_path)


def process_job(job_id, job):
    job_ref = fs.collection('jobs').document(job_id)
    video_id = job.get('videoId')
    if not video_id:
        log(job_ref, 'Job sem videoId'); set_status(job_ref, 'failed'); return

    steps = job.get('steps') or ['ingest','transcribe','translate-en','translate-es','tts-en','tts-es','upload','mux']
    current = job.get('currentStep')

    try:
        set_status(job_ref, 'running', current or 'ingest')
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'audio.wav')
            pt_srt = os.path.join(tmp, 'pt.srt')
            en_srt = os.path.join(tmp, 'en.srt')
            es_srt = os.path.join(tmp, 'es.srt')
            en_mp3 = os.path.join(tmp, 'en.mp3')
            es_mp3 = os.path.join(tmp, 'es.mp3')

            # INGEST
            if 'ingest' in steps:
                set_status(job_ref, 'running', 'ingest')
                # ingest não gera artefato persistente; sempre executar rápido
                log(job_ref, 'Baixando áudio via yt-dlp...')
                youtube_audio_to_wav(video_id, wav)

            # TRANSCRIBE
            if 'transcribe' in steps:
                set_status(job_ref, 'running', 'transcribe')
                dest = f"subs/{video_id}/pt.srt"
                if exists_in_storage(dest):
                    log(job_ref, 'Transcrição PT já existe, pulando')
                else:
                    log(job_ref, 'Transcrevendo PT...')
                    transcribe_wav_to_srt_pt(wav, pt_srt)
                    upload_file(pt_srt, dest)

            # TRANSLATE EN
            if 'translate-en' in steps:
                set_status(job_ref, 'running', 'translate-en')
                src = f"subs/{video_id}/pt.srt"
                dest = f"subs/{video_id}/en.srt"
                if exists_in_storage(dest):
                    log(job_ref, 'Tradução EN já existe, pulando')
                else:
                    # baixar PT do storage se não existir local
                    tmp_pt = pt_srt if os.path.exists(pt_srt) else os.path.join(tmp, 'dl_pt.srt')
                    if tmp_pt == os.path.join(tmp, 'dl_pt.srt'):
                        # download
                        if os.getenv('FIREBASE_STORAGE_EMULATOR_HOST'):
                            url = f"http://{os.getenv('FIREBASE_STORAGE_EMULATOR_HOST')}/v0/b/{bucket_name}/o/{src}?alt=media"
                            r = requests.get(url)
                            r.raise_for_status()
                            open(tmp_pt, 'wb').write(r.content)
                        else:
                            bucket.blob(src).download_to_filename(tmp_pt)
                    translate_srt(tmp_pt, 'en', en_srt)
                    upload_file(en_srt, dest)

            # TRANSLATE ES
            if 'translate-es' in steps:
                set_status(job_ref, 'running', 'translate-es')
                src = f"subs/{video_id}/pt.srt"
                dest = f"subs/{video_id}/es.srt"
                if exists_in_storage(dest):
                    log(job_ref, 'Tradução ES já existe, pulando')
                else:
                    tmp_pt = pt_srt if os.path.exists(pt_srt) else os.path.join(tmp, 'dl_pt.srt')
                    if tmp_pt == os.path.join(tmp, 'dl_pt.srt'):
                        if os.getenv('FIREBASE_STORAGE_EMULATOR_HOST'):
                            url = f"http://{os.getenv('FIREBASE_STORAGE_EMULATOR_HOST')}/v0/b/{bucket_name}/o/{src}?alt=media"
                            r = requests.get(url)
                            r.raise_for_status()
                            open(tmp_pt, 'wb').write(r.content)
                        else:
                            bucket.blob(src).download_to_filename(tmp_pt)
                    translate_srt(tmp_pt, 'es', es_srt)
                    upload_file(es_srt, dest)

            # TTS EN (stub)
            if 'tts-en' in steps:
                set_status(job_ref, 'running', 'tts-en')
                dest = f"dubs/{video_id}/en.mp3"
                if exists_in_storage(dest):
                    log(job_ref, 'Dub EN já existe, pulando')
                else:
                    tmp_en = en_srt if os.path.exists(en_srt) else os.path.join(tmp, 'dl_en.srt')
                    if tmp_en == os.path.join(tmp, 'dl_en.srt'):
                        src = f"subs/{video_id}/en.srt"
                        if os.getenv('FIREBASE_STORAGE_EMULATOR_HOST'):
                            url = f"http://{os.getenv('FIREBASE_STORAGE_EMULATOR_HOST')}/v0/b/{bucket_name}/o/{src}?alt=media"
                            r = requests.get(url)
                            r.raise_for_status()
                            open(tmp_en, 'wb').write(r.content)
                        else:
                            bucket.blob(src).download_to_filename(tmp_en)
                    tts_stub(srt_to_plaintext(tmp_en), en_mp3, 'en')
                    upload_file(en_mp3, dest)

            # TTS ES (stub)
            if 'tts-es' in steps:
                set_status(job_ref, 'running', 'tts-es')
                dest = f"dubs/{video_id}/es.mp3"
                if exists_in_storage(dest):
                    log(job_ref, 'Dub ES já existe, pulando')
                else:
                    tmp_es = es_srt if os.path.exists(es_srt) else os.path.join(tmp, 'dl_es.srt')
                    if tmp_es == os.path.join(tmp, 'dl_es.srt'):
                        src = f"subs/{video_id}/es.srt"
                        if os.getenv('FIREBASE_STORAGE_EMULATOR_HOST'):
                            url = f"http://{os.getenv('FIREBASE_STORAGE_EMULATOR_HOST')}/v0/b/{bucket_name}/o/{src}?alt=media"
                            r = requests.get(url)
                            r.raise_for_status()
                            open(tmp_es, 'wb').write(r.content)
                        else:
                            bucket.blob(src).download_to_filename(tmp_es)
                    tts_stub(srt_to_plaintext(tmp_es), es_mp3, 'es')
                    upload_file(es_mp3, dest)

        # finalize video doc
        fs.collection('videos').document(video_id).set({
            'status': 'ready',
            'langs': { 'pt': True, 'en': True, 'es': True }
        }, merge=True)

        # persistir progresso do job
        job_ref.update({'steps': steps, 'currentStep': 'mux'})
        set_status(job_ref, 'done', 'mux')
        log(job_ref, 'Concluído')
    except subprocess.CalledProcessError as e:
        log(job_ref, f'Erro de subprocesso: {e}')
        set_status(job_ref, 'failed')
    except Exception as e:
        log(job_ref, f'Falha: {e}')
        set_status(job_ref, 'failed')


def main_loop():
    print('Worker iniciado...')
    while True:
        # buscar jobs com status=running (prioridade) ou queued
        jobs_ref = fs.collection('jobs')
        running = jobs_ref.where('status', '==', 'running').limit(1).stream()
        queued = jobs_ref.where('status', '==', 'queued').limit(1).stream()
        picked = None
        for d in running:
            picked = d; break
        if not picked:
            for d in queued:
                picked = d; break
        if picked:
            process_job(picked.id, picked.to_dict())
        else:
            time.sleep(3)

if __name__ == '__main__':
    main_loop()