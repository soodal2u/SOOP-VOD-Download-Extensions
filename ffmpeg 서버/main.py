from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
import os
import uuid
import ffmpeg
import time
import threading
import re
import subprocess
import signal
import sys
import json
import requests
from urllib.parse import urlparse

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, expose_headers=["Content-Disposition"])

restart_cooldown = 3 * 60 * 60
STATUS_FILE = "restart_status.json"

UPLOAD_FOLDER = "uploads"
OUTPUT_FOLDER = "output"
ZIP_FOLDER = "zip_files"  # ZIP 파일을 저장할 폴더 추가

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)
os.makedirs(ZIP_FOLDER, exist_ok=True)  # ZIP 폴더 생성

# ffmpeg 경로 설정 (시스템 PATH에 있는 경우)
ffmpeg_path = "ffmpeg"
ffprobe_path = "ffprobe"

ffmpeg_processes = []  # Track active ffmpeg processes


def natural_key(string_):
    """Sort helper that sorts strings by embedded numbers"""
    return [
        int(text) if text.isdigit() else text.lower()
        for text in re.split("(\d+)", string_)
    ]


def create_file_list(ts_dir, file_list_path="file_list.txt"):
    ts_files = [f for f in os.listdir(ts_dir) if f.endswith(".ts")]
    ts_files.sort(key=natural_key)
    with open(file_list_path, "w", encoding="utf-8") as file_list:
        for ts_file in ts_files:
            file_list.write(
                f"file '{os.path.abspath(os.path.join(ts_dir, ts_file))}'\n"
            )
    return ts_files


def extract_title_from_filename(ts_file):
    """Extract title from the TS file name"""
    return ts_file.split("_seg-")[0]


def get_unique_filename(output_folder, filename):
    """중복되지 않는 파일 이름 생성"""
    base, ext = os.path.splitext(filename)
    counter = 1
    new_filename = filename

    while os.path.exists(os.path.join(output_folder, new_filename)):
        new_filename = f"{base}_{counter}{ext}"
        counter += 1

    return new_filename


def sanitize_filename(filename):
    """파일 이름에서 허용되지 않는 문자 제거 (확장자 보존)"""
    if not filename:
        return "video"

    # 확장자 분리
    name, ext = os.path.splitext(filename)

    # Windows에서 문제가 되는 문자들 제거 (점 제외)
    invalid_chars = r'[<>:"/\\|?*\[\]()]'
    name = re.sub(invalid_chars, "_", name)

    # 연속된 언더스코어 제거
    name = re.sub(r"_+", "_", name)

    # 앞뒤 공백 및 언더스코어 제거
    name = name.strip("_ ")

    # 빈 문자열 처리
    if not name:
        name = "video"

    # 파일명이 너무 길면 자르기
    if len(name) > 80:
        name = name[:80]

    # 확장자가 없으면 .mp4 추가
    if not ext:
        ext = ".mp4"

    return name + ext


def merge_ts_files(
    ffmpeg_path, output_file="output_video.mp4", file_list_path="file_list.txt"
):
    output_folder = "output"
    os.makedirs(output_folder, exist_ok=True)

    output_file = sanitize_filename(output_file)
    unique_output_file = os.path.join(output_folder, output_file)

    ffmpeg_command = [
        ffmpeg_path,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        file_list_path,
        "-c",
        "copy",
        unique_output_file,
    ]
    try:
        subprocess.run(ffmpeg_command, check=True)
        print(f"Output saved as: {unique_output_file}")
        return unique_output_file
    except subprocess.CalledProcessError as e:
        print(f"Error: {e}")
        raise


def terminate_ffmpeg_processes():
    """Terminate all active ffmpeg processes gracefully"""
    for process in ffmpeg_processes:
        try:
            process.terminate()
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def load_restart_status():
    """파일에서 마지막 재시작 시간을 로드"""
    if os.path.exists(STATUS_FILE):
        with open(STATUS_FILE, "r") as f:
            try:
                data = json.load(f)
                return data.get("last_restart_time", 0)
            except json.JSONDecodeError:
                return 0
    return 0


def save_restart_status(last_restart_time):
    """마지막 재시작 시간을 파일에 저장"""
    with open(STATUS_FILE, "w") as f:
        json.dump({"last_restart_time": last_restart_time}, f)


def delete_file_later(file_path, delay=10):
    def delayed_delete():
        time.sleep(delay)
        try:
            os.remove(file_path)
            print(f"Successfully removed {file_path}")
        except Exception as e:
            print(f"Error removing file {file_path}: {e}")

    threading.Thread(target=delayed_delete).start()


def find_available_zip_file():
    """zip_files 폴더에서 사용 가능한 ZIP 파일 찾기"""
    if not os.path.exists(ZIP_FOLDER):
        return None
    
    # ZIP 파일 목록 가져오기
    zip_files = [f for f in os.listdir(ZIP_FOLDER) if f.lower().endswith('.zip')]
    
    if not zip_files:
        return None
    
    # 가장 최근에 수정된 ZIP 파일 선택
    zip_files_with_time = []
    for zip_file in zip_files:
        zip_path = os.path.join(ZIP_FOLDER, zip_file)
        mtime = os.path.getmtime(zip_path)
        zip_files_with_time.append((zip_file, mtime))
    
    # 수정 시간 기준으로 정렬 (최신 파일이 먼저)
    zip_files_with_time.sort(key=lambda x: x[1], reverse=True)
    
    return zip_files_with_time[0][0]  # 가장 최근 파일명 반환


@app.route("/download-zip", methods=["GET"])
def download_zip():
    """서버에 준비된 ZIP 파일 다운로드"""
    try:
        print("ZIP 파일 다운로드 요청 받음")
        
        # 사용 가능한 ZIP 파일 찾기
        zip_filename = find_available_zip_file()
        
        if not zip_filename:
            print("다운로드할 ZIP 파일이 없음")
            return jsonify({
                "error": "서버에 다운로드할 ZIP 파일이 없습니다. 관리자에게 문의하세요."
            }), 404
        
        zip_file_path = os.path.join(ZIP_FOLDER, zip_filename)
        
        # 파일 존재 확인
        if not os.path.exists(zip_file_path):
            print(f"ZIP 파일이 존재하지 않음: {zip_file_path}")
            return jsonify({
                "error": "요청한 ZIP 파일을 찾을 수 없습니다."
            }), 404
        
        # 파일 크기 확인
        file_size = os.path.getsize(zip_file_path)
        if file_size == 0:
            print(f"ZIP 파일이 비어있음: {zip_file_path}")
            return jsonify({
                "error": "ZIP 파일이 손상되었습니다."
            }), 500
        
        print(f"ZIP 파일 다운로드 시작: {zip_filename} ({file_size} bytes)")
        
        # ZIP 파일 다운로드 응답
        response = send_file(
            zip_file_path,
            as_attachment=True,
            download_name=zip_filename,
            mimetype="application/zip"
        )
        
        print(f"ZIP 파일 다운로드 완료: {zip_filename}")
        return response
        
    except Exception as e:
        print(f"ZIP 다운로드 중 예상치 못한 오류: {e}")
        return jsonify({
            "error": f"ZIP 파일 다운로드 중 오류가 발생했습니다: {str(e)}"
        }), 500


@app.route("/restart-status", methods=["GET"])
def restart_status():
    """재시작 가능 여부와 남은 시간을 반환"""
    last_restart_time = load_restart_status()
    current_time = time.time()
    time_since_last_restart = current_time - last_restart_time
    remaining_time = max(0, int(restart_cooldown - time_since_last_restart))

    return (
        jsonify(
            {
                "can_restart": time_since_last_restart >= restart_cooldown,
                "remaining_time": remaining_time,
            }
        ),
        200,
    )


@app.route("/restart", methods=["POST"])
def restart_server():
    """사용자 요청에 의한 수동 재시작만 허용"""
    last_restart_time = load_restart_status()
    current_time = time.time()
    time_since_last_restart = current_time - last_restart_time

    # 재시작 제한 시간 확인
    if time_since_last_restart < restart_cooldown:
        remaining_time = int(restart_cooldown - time_since_last_restart)
        return (
            jsonify(
                {
                    "error": "서버 재시작은 너무 자주 실행할 수 없습니다.",
                    "remaining_time": remaining_time,
                }
            ),
            429,
        )

    # 제한 시간 경과: 상태 저장
    save_restart_status(current_time)

    print("사용자 요청에 의한 서버 재시작...")

    # 응답을 먼저 보내고 지연 후 종료
    def delayed_shutdown():
        time.sleep(1)
        print("Shutting down main.py for restart...")
        os._exit(0)

    threading.Thread(target=delayed_shutdown).start()
    return jsonify({"message": "서버가 재시작됩니다."}), 200


@app.route("/process-playlist", methods=["POST"])
def process_playlist():
    """원본 URL을 직접 사용하여 고속 처리"""
    try:
        playlist_file = request.files.get("playlistFile")
        start_time = float(request.form.get("startTime", 0))
        duration_param = request.form.get("duration")
        duration = (
            float(duration_param)
            if duration_param and duration_param != "null"
            else None
        )
        title = request.form.get("title", "video")
        include_title = request.form.get("includeTitle", "false").lower() == "true"

        if not playlist_file:
            return jsonify({"error": "playlist 파일이 필요합니다."}), 400

        # playlist 파일 내용 읽기
        playlist_content = playlist_file.read().decode("utf-8")
        print(f"Playlist 내용:\n{playlist_content[:500]}...")

        # 원본 URL 추출
        original_url = extract_original_url_from_content(playlist_content)

        if original_url:
            # Master Playlist인 경우 "original" 화질 URL 추출 시도
            if "#EXT-X-STREAM-INF" in playlist_content:
                print("Master Playlist 감지됨. 'original' 화질 선택 시도...")
                lines = playlist_content.split("\n")
                for i, line in enumerate(lines):
                    if 'NAME="original"' in line:
                        # 다음 라인이 URL
                        if i + 1 < len(lines):
                            variant_url = lines[i+1].strip()
                            if variant_url and not variant_url.startswith("#"):
                                # 상대 경로를 절대 경로로 변환
                                from urllib.parse import urljoin
                                original_url = urljoin(original_url, variant_url)
                                print(f"'original' 화질 URL 선택됨: {original_url}")
                                break

            print(f"처리할 URL: {original_url}")
            return process_with_original_url_fast(
                original_url, start_time, duration, title, include_title
            )
        else:
            return (
                jsonify(
                    {
                        "error": "원본 URL을 찾을 수 없습니다. 올바른 playlist.m3u8 파일인지 확인해주세요."
                    }
                ),
                400,
            )

    except Exception as e:
        print(f"playlist 처리 오류: {e}")
        return (
            jsonify({"error": f"playlist 처리 중 오류가 발생했습니다: {str(e)}"}),
            500,
        )


def extract_original_url_from_content(content):
    """playlist 내용에서 원본 URL 추출"""
    lines = content.split("\n")

    # 주석에서 원본 URL 찾기
    for line in lines:
        if line.startswith("# Original URL:"):
            return line.replace("# Original URL:", "").strip()

    # 실제 URL 라인에서 찾기
    for line in lines:
        line = line.strip()
        if line.startswith("http") and "playlist.m3u8" in line:
            return line
        elif line.startswith("http") and (".m3u8" in line or ".ts" in line):
            if "/seg-" in line:
                base_url = line.split("/seg-")[0]
                return f"{base_url}/playlist.m3u8"

    return None


def process_with_original_url_fast(
    playlist_url, start_time=0, duration=None, title="video", include_title=False
):
    """고속 처리를 위한 최적화된 FFmpeg 처리 (Direct Streaming & Process Killing)"""
    try:
        # 안전한 파일명 생성 (다운로드 헤더용)
        if include_title and title:
            safe_title = re.sub(r'[<>:"/\\|?*\[\]()]', "_", title)[:50]
            output_filename = f"{safe_title}_{int(time.time())}.mp4"
        else:
            output_filename = f"video_{int(time.time())}.mp4"

        # 고속 처리를 위한 최적화된 FFmpeg 명령어
        ffmpeg_command = [ffmpeg_path, "-y"]

        # HTTP 연결 최적화 및 분석 시간 단축
        ffmpeg_command.extend(
            [
                "-reconnect", "1",
                "-reconnect_streamed", "1",
                "-reconnect_delay_max", "5",
                "-analyzeduration", "10000000",  # 10초
                "-probesize", "10000000",        # 10MB
                "-threads", "0",                 # 자동 스레드
            ]
        )

        # 시작 시간 설정
        if start_time > 0:
            ffmpeg_command.extend(["-ss", str(start_time)])

        ffmpeg_command.extend(["-i", playlist_url])

        # 지속 시간 설정
        if duration and duration > 0:
            ffmpeg_command.extend(["-t", str(duration)])

        # 고속 처리 및 스트리밍 옵션
        ffmpeg_command.extend(
            [
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-af", "aresample=async=1",
                "-bsf:v", "setts=pts=PTS-STARTPTS",
                "-avoid_negative_ts", "make_zero",
                "-f", "mp4",
                "-movflags", "frag_keyframe+empty_moov",  # Fragmented MP4 for streaming
                "-fflags", "+genpts",
                "pipe:1",  # Output to stdout
            ]
        )

        print(f"Direct Streaming FFmpeg Command: {' '.join(ffmpeg_command)}")

        # Popen으로 프로세스 생성 (비동기)
        process = subprocess.Popen(
            ffmpeg_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,  # Unbuffered
        )

        # Queue를 사용하여 스레드 간 데이터 전달
        import queue
        output_queue = queue.Queue()
        error_queue = queue.Queue()

        def read_stdout(p, q):
            try:
                for chunk in iter(lambda: p.stdout.read(4096), b''):
                    q.put(('data', chunk))
                q.put(('done', None))
            except Exception as e:
                q.put(('error', str(e)))

        def read_stderr(p):
            try:
                for line in iter(p.stderr.readline, b''):
                    try:
                        line_str = line.decode('utf-8').strip()
                    except:
                        line_str = line.decode('cp949', errors='ignore').strip()
                    if line_str:
                        print(f"[FFmpeg] {line_str}")
            except Exception as e:
                print(f"Stderr reading error: {e}")

        # 스레드 시작
        stdout_thread = threading.Thread(target=read_stdout, args=(process, output_queue))
        stderr_thread = threading.Thread(target=read_stderr, args=(process,))
        stdout_thread.daemon = True
        stderr_thread.daemon = True
        stdout_thread.start()
        stderr_thread.start()

        def generate():
            try:
                while True:
                    try:
                        # 큐에서 데이터 가져오기 (타임아웃 설정으로 블로킹 방지 가능)
                        # 여기서는 타임아웃 없이 대기하되, 클라이언트 연결 끊김은 yield 시점에 감지됨
                        item_type, item_data = output_queue.get(timeout=1) 
                    except queue.Empty:
                        # 데이터가 안 들어오면 프로세스 상태 확인
                        if process.poll() is not None:
                            # 프로세스가 끝났는데 큐가 비었으면 종료
                            break
                        continue

                    if item_type == 'data':
                        yield item_data
                    elif item_type == 'done':
                        break
                    elif item_type == 'error':
                        print(f"Stream reader error: {item_data}")
                        break
            except GeneratorExit:
                print(f"Client disconnected! Killing FFmpeg process {process.pid}...")
                process.kill()
                raise
            except Exception as e:
                print(f"Streaming error: {e}")
                process.kill()
                raise
            finally:
                if process.poll() is None:
                    print(f"Terminating FFmpeg process {process.pid}...")
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()

        # Flask Response 객체 생성 (스트리밍)
        from flask import Response
        from urllib.parse import quote
        
        # 파일명 URL 인코딩 (한글 파일명 지원)
        encoded_filename = quote(output_filename)
        
        return Response(
            generate(),
            mimetype="video/mp4",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            }
        )

    except Exception as e:
        print(f"고속 처리 오류: {e}")
        return jsonify({"error": str(e)}), 500

        # Flask Response 객체 생성 (스트리밍)
        from flask import Response
        return Response(
            generate(),
            mimetype="video/mp4",
            headers={
                "Content-Disposition": f"attachment; filename={output_filename}"
            }
        )

    except Exception as e:
        print(f"고속 처리 오류: {e}")
        # 스트리밍 시작 전 에러라면 JSON 응답
        return jsonify({"error": str(e)}), 500


def process_with_alternative_fast(
    playlist_url, start_time=0, duration=None, output_filename="video.mp4"
):
    """대안 고속 처리 방법 (Direct Streaming & Process Killing)"""
    try:
        # 대안 고속 처리 명령어
        ffmpeg_command = [ffmpeg_path, "-y"]

        # 네트워크 최적화
        ffmpeg_command.extend(
            [
                "-user_agent", "Mozilla/5.0",
                "-headers", "Connection: keep-alive",
                "-multiple_requests", "1",
                "-analyzeduration", "10000000",
                "-probesize", "10000000",
                "-threads", "0",
            ]
        )

        if start_time > 0:
            ffmpeg_command.extend(["-ss", str(start_time)])

        ffmpeg_command.extend(["-i", playlist_url])

        if duration and duration > 0:
            ffmpeg_command.extend(["-t", str(duration)])

        ffmpeg_command.extend(
            [
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-af", "aresample=async=1",
                "-bsf:v", "setts=pts=PTS-STARTPTS",
                "-bsf:a", "aac_adtstoasc",
                "-movflags", "frag_keyframe+empty_moov", # Streaming friendly
                "-f", "mp4",
                "pipe:1", # Output to stdout
            ]
        )

        print(f"Alternative Direct Streaming FFmpeg Command: {' '.join(ffmpeg_command)}")

        # Popen으로 프로세스 생성 (비동기)
        process = subprocess.Popen(
            ffmpeg_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )

        # Queue를 사용하여 스레드 간 데이터 전달
        import queue
        output_queue = queue.Queue()

        def read_stdout(p, q):
            try:
                for chunk in iter(lambda: p.stdout.read(4096), b''):
                    q.put(('data', chunk))
                q.put(('done', None))
            except Exception as e:
                q.put(('error', str(e)))

        def read_stderr(p):
            try:
                for line in iter(p.stderr.readline, b''):
                    try:
                        line_str = line.decode('utf-8').strip()
                    except:
                        line_str = line.decode('cp949', errors='ignore').strip()
                    if line_str:
                        print(f"[FFmpeg Alt] {line_str}")
            except Exception as e:
                print(f"Stderr reading error (Alt): {e}")

        # 스레드 시작
        stdout_thread = threading.Thread(target=read_stdout, args=(process, output_queue))
        stderr_thread = threading.Thread(target=read_stderr, args=(process,))
        stdout_thread.daemon = True
        stderr_thread.daemon = True
        stdout_thread.start()
        stderr_thread.start()

        def generate():
            try:
                while True:
                    try:
                        item_type, item_data = output_queue.get(timeout=1)
                    except queue.Empty:
                        if process.poll() is not None:
                            break
                        continue

                    if item_type == 'data':
                        yield item_data
                    elif item_type == 'done':
                        break
                    elif item_type == 'error':
                        print(f"Stream reader error (Alt): {item_data}")
                        break
            except GeneratorExit:
                print(f"Client disconnected (Alt)! Killing FFmpeg process {process.pid}...")
                process.kill()
                raise
            except Exception as e:
                print(f"Streaming error (Alt): {e}")
                process.kill()
                raise
            finally:
                if process.poll() is None:
                    print(f"Terminating FFmpeg process (Alt) {process.pid}...")
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()

        from flask import Response
        from urllib.parse import quote
        
        encoded_filename = quote(output_filename)
        
        return Response(
            generate(),
            mimetype="video/mp4",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            }
        )

    except Exception as e:
        print(f"대안 고속 처리 오류: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/upload", methods=["POST"])
def upload_files():
    """TS 파일들을 업로드하고 병합"""
    upload_id = str(uuid.uuid4())
    upload_dir = os.path.join(UPLOAD_FOLDER, upload_id)
    os.makedirs(upload_dir, exist_ok=True)

    files = request.files.getlist("tsFiles")
    ts_file_paths = []

    for file in files:
        file_path = os.path.join(upload_dir, file.filename)
        file.save(file_path)
        ts_file_paths.append(file_path)

    file_list_path = os.path.join(upload_dir, "file_list.txt")

    title = extract_title_from_filename(files[0].filename) if files else "output"
    output_file_name = f"{title}.mp4"

    try:
        create_file_list(upload_dir, file_list_path)
        output_file_path = merge_ts_files(ffmpeg_path, output_file_name, file_list_path)

        response = send_file(
            output_file_path, as_attachment=True, download_name=output_file_name
        )

        def cleanup():
            time.sleep(2)
            try:
                os.remove(output_file_path)
                print(f"Deleted file: {output_file_path}")
            except Exception as e:
                print(f"Error deleting file: {e}")

        threading.Thread(target=cleanup).start()

        return response
    except FileNotFoundError as e:
        print(f"FileNotFoundError: {e}")
        return jsonify(error="Merged file not found."), 500
    except subprocess.CalledProcessError as e:
        print(f"stderr: {e}")
        return jsonify(error=str(e)), 500
    finally:
        for file_path in ts_file_paths:
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Error removing {file_path}: {e}")
        if os.path.exists(file_list_path):
            try:
                os.remove(file_list_path)
            except Exception as e:
                print(f"Error removing {file_list_path}: {e}")
        if os.path.exists(upload_dir):
            try:
                os.rmdir(upload_dir)
            except Exception as e:
                print(f"Error removing directory {upload_dir}: {e}")


@app.route("/health", methods=["GET"])
def health_check():
    """서버 상태 확인"""
    return (
        jsonify(
            {
                "status": "healthy",
                "timestamp": time.time(),
                "active_processes": len(ffmpeg_processes),
            }
        ),
        200,
    )


if __name__ == "__main__":
    try:
        print("서버가 시작됩니다...")
        print(f"업로드 폴더: {UPLOAD_FOLDER}")
        print(f"출력 폴더: {OUTPUT_FOLDER}")
        print(f"ZIP 파일 폴더: {ZIP_FOLDER}")  # ZIP 폴더 정보 추가
        print(f"FFmpeg 경로: {ffmpeg_path}")
        print("자동 재시작 비활성화 - 수동 재시작만 가능")

        # debug=False로 설정하여 자동 재시작 방지
        # Dual Protocol Support (HTTP & HTTPS)
        def run_http():
            try:
                print("HTTP 서버 시작 (Port: 2053)...")
                app.run(host="0.0.0.0", port=2053, debug=False, use_reloader=False)
            except Exception as e:
                print(f"HTTP 서버 실행 중 오류 발생: {e}")

        def run_https():
            cert_path = "certs/cert.pem"
            key_path = "certs/key.pem"
            
            if os.path.exists(cert_path) and os.path.exists(key_path):
                try:
                    print(f"SSL 인증서 발견: {cert_path}, {key_path}")
                    print("HTTPS 서버 시작 (Port: 2083)...")
                    ssl_context = (cert_path, key_path)
                    app.run(host="0.0.0.0", port=2083, debug=False, use_reloader=False, ssl_context=ssl_context)
                except Exception as e:
                    print(f"HTTPS 서버 실행 중 오류 발생: {e}")
            else:
                print("SSL 인증서를 찾을 수 없어 HTTPS 서버를 시작하지 않습니다.")
                print(f"참고: 인증서 위치는 {os.path.abspath('certs')} 폴더여야 합니다.")

        # 스레드로 각각 실행
        http_thread = threading.Thread(target=run_http)
        https_thread = threading.Thread(target=run_https)

        http_thread.start()
        https_thread.start()

        # 메인 스레드는 대기 (KeyboardInterrupt 처리를 위해)
        try:
            http_thread.join()
            https_thread.join()
        except KeyboardInterrupt:
            # 이 부분은 메인 스레드에서 잡히지 않을 수 있음 (스레드 join 중이라)
            # 하지만 상위 try-except 블록이 있어서 괜찮음
            pass
    except KeyboardInterrupt:
        terminate_ffmpeg_processes()
        print("Server terminated gracefully.")
