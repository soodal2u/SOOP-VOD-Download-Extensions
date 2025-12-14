import subprocess
import time
import os
import signal

def is_process_running(pid_file):
    """Check if a process is already running using a PID file."""
    if not os.path.exists(pid_file):
        return False

    try:
        with open(pid_file, 'r') as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)  # Test if the process is running
    except (ValueError, OSError):
        return False

    return True

def terminate_process(pid_file):
    """Terminate the process if it's running."""
    if not is_process_running(pid_file):
        return

    with open(pid_file, 'r') as f:
        pid = int(f.read().strip())
    try:
        os.kill(pid, signal.SIGTERM)  # Gracefully terminate the process
        time.sleep(3)  # Wait for process to terminate
    except OSError:
        pass
    os.remove(pid_file)  # Clean up PID file

def write_pid_file(pid_file):
    """Write the current process ID to a PID file."""
    with open(pid_file, 'w') as f:
        f.write(str(os.getpid()))

def start_server():
    """Run main.py and restart if it stops."""
    pid_file = 'main_pid.txt'

    # Ensure no duplicate processes
    terminate_process(pid_file)
    write_pid_file(pid_file)

    try:
        while True:
            print("Starting main.py...")
            process = subprocess.Popen(['python', 'main.py'])

            # Wait for the process to complete
            process.wait()

            print("main.py has stopped. Restarting in 5 seconds...")
            time.sleep(5)
    finally:
        # Clean up PID file on exit
        if os.path.exists(pid_file):
            os.remove(pid_file)

if __name__ == "__main__":
    start_server()
