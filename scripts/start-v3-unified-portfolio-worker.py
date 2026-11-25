"""Confirm the installed portfolio oneshot before publishing its testnet panel."""
import re
import subprocess
import sys
import time


def systemctl(*args):
    return subprocess.run(["systemctl", *args], capture_output=True, text=True, check=False)


def service_state(service):
    numeric = ("ExecMainCode", "ExecMainStatus", "ExecMainStartTimestampMonotonic", "ExecMainExitTimestampMonotonic")
    fields = ("ActiveState", "Result", *numeric, "InvocationID")
    result = systemctl("show", "--all", "--property=" + ",".join(fields), service)
    state = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if result.returncode or any(not state.get(key, "").isdigit() for key in numeric):
        raise RuntimeError("UNIFIED_WORKER_SERVICE_STATE_UNAVAILABLE")
    return state


def scheduled_run(service, timer, after_start):
    # An old invocation can still be in progress at daemon-reload. Allow it and one
    # fresh six-minute oneshot to finish, including the timer's 15-second interval.
    deadline = time.monotonic() + 2 * 360 + 45
    while time.monotonic() < deadline:
        state = service_state(service)
        started = int(state["ExecMainStartTimestampMonotonic"])
        ended = int(state["ExecMainExitTimestampMonotonic"])
        if started > after_start and ended >= started and state["ActiveState"] in ("inactive", "failed"):
            return state
        if systemctl("is-active", "--quiet", timer).returncode:
            raise RuntimeError("UNIFIED_WORKER_TIMER_STOPPED")
        time.sleep(2)
    raise RuntimeError("UNIFIED_WORKER_FRESH_RUN_TIMEOUT")


def report_failure(service, state, since):
    # Only terminal worker codes are safe to copy from the journal to a root terminal.
    pattern = "^[A-Z][A-Z0-9_]{3,100}$"
    args = ["journalctl", "--quiet", "--no-pager", "-b", "-u", service, "--since", "@" + str(since),
            "-o", "cat", "-n", "1", "--grep=" + pattern]
    invocation = state.get("InvocationID", "")
    if re.fullmatch("[0-9a-f]{32}", invocation) and int(invocation, 16):
        args.append("_SYSTEMD_INVOCATION_ID=" + invocation)
    log = subprocess.run(args, capture_output=True, text=True, check=False)
    reason = log.stdout.strip()
    if not re.fullmatch(pattern, reason):
        reason = "NO_WORKER_CODE"
    result = state.get("Result", "")
    if not re.fullmatch("[a-z-]{1,48}", result):
        result = "unknown"
    print(f"UNIFIED_WORKER_START_FAILED result={result} exit={state['ExecMainStatus']} reason={reason}",
          file=sys.stderr, flush=True)


def start(unit, gas_status):
    service, timer = unit + ".service", unit + ".timer"
    since = int(time.time())
    scheduled = systemctl("is-active", "--quiet", timer).returncode == 0
    if scheduled:
        after_start = int(service_state(service)["ExecMainStartTimestampMonotonic"])
        print("UNIFIED_WORKER_WAITING_FOR_FRESH_TIMER_RUN", flush=True)
    for attempt in range(2):
        if scheduled:
            try:
                state = scheduled_run(service, timer, after_start)
            except RuntimeError:
                report_failure(service, service_state(service), since)
                raise
        else:
            # A successful blocking oneshot start is definitive even if systemd
            # unloads the inactive service before the timer is first enabled.
            if systemctl("start", service).returncode == 0:
                return 0
            state = service_state(service)
        code = int(state["ExecMainStatus"])
        if (scheduled and state["Result"] == "success" and state["ExecMainCode"] == "1"
                and state["ActiveState"] == "inactive" and (code == 0 or code == gas_status == 42)):
            return 0
        report_failure(service, state, since)
        if attempt or (state["Result"], state["ExecMainCode"], code) != ("exit-code", "1", 75):
            return 1
        # Exit 75 is exclusive to exhausted RPC verification before any signature.
        # With an active schedule, observe its next run without starting another job.
        print("UNIFIED_WORKER_RETRYING_READ_ONLY_PREFLIGHT", flush=True)
        if scheduled:
            after_start = int(state["ExecMainStartTimestampMonotonic"])
        else:
            time.sleep(15)
    return 1


if __name__ == "__main__":
    if (len(sys.argv) != 3 or sys.argv[1] not in ("global-v3-portfolio-keeper-testnet",
            "global-v3-plan-portfolio-keeper-testnet") or sys.argv[2] not in ("0", "42")):
        sys.exit("UNIFIED_WORKER_INVALID_ARGUMENTS")
    try:
        sys.exit(start(sys.argv[1], int(sys.argv[2])))
    except RuntimeError as error:
        sys.exit(str(error))
