#!/usr/bin/env bash
# setup_ptp_pi.sh
set -euo pipefail

MODE="${1:-gm}"   # gm | slave
if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root: sudo $0 [gm|slave]"
  exit 1
fi
if [[ "$MODE" != "gm" && "$MODE" != "slave" ]]; then
  echo "Usage: $0 [gm|slave]   (default: gm)"
  exit 1
fi

echo "[1/8] Installing packages (linuxptp, chrony, ethtool)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y linuxptp chrony ethtool

echo "[2/8] Detecting wired interface..."
# Prefer carrier-up ethernet-like names; fallback to eth0 if present
IFACE=""
# Use ip to list non-loopback links
while read -r idx name rest; do
  n="${name%:}"
  [[ "$n" == "lo" ]] && continue
  [[ -d "/sys/class/net/$n" ]] || continue
  if [[ -f "/sys/class/net/$n/carrier" ]] && grep -q 1 "/sys/class/net/$n/carrier"; then
    IFACE="$n"
    break
  fi
done < <(ip -o link show)

# fallbacks
if [[ -z "${IFACE}" && -d /sys/class/net/eth0 ]]; then
  IFACE="eth0"
fi
if [[ -z "${IFACE}" ]]; then
  echo "Could not detect a wired interface with carrier. Plug in Ethernet and retry."
  exit 1
fi
echo "Using interface: $IFACE"

echo "[3/8] Checking PTP Hardware Clock support on $IFACE..."
PHC_AVAILABLE=0
if ethtool -T "$IFACE" | grep -q "PTP Hardware Clock:"; then
  # Some drivers print the PHC number; others say "none"
  if ethtool -T "$IFACE" | grep -q "PTP Hardware Clock: [0-9]"; then
    PHC_AVAILABLE=1
  fi
fi
if [[ "$PHC_AVAILABLE" -eq 1 ]]; then
  echo "PHC FOUND on $IFACE (hardware timestamping)."
else
  echo "No PHC exposed on $IFACE; will use SOFTWARE timestamping."
fi

echo "[4/8] Building ptp4l command-line arguments..."
# Build timestamping argument based on PHC availability
if [[ $PHC_AVAILABLE -eq 1 ]]; then
  TIMESTAMP_ARG="-H"  # Hardware timestamping
else
  TIMESTAMP_ARG="-S"  # Software timestamping
fi
echo "Timestamping mode: $( [[ $PHC_AVAILABLE -eq 1 ]] && echo 'hardware (-H)' || echo 'software (-S)' )"

echo "[5/8] Writing an environment file with your interface..."
cat >/etc/default/ptp <<EOF
# Used by the systemd units created by setup_ptp_pi.sh
PTP_IFACE="$IFACE"
PTP_PHC_AVAILABLE="$PHC_AVAILABLE"
PTP_TIMESTAMP_ARG="$TIMESTAMP_ARG"
EOF

echo "[6/8] Creating systemd service units..."

# Helper: common hardening options
HARDEN='
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true
'

# ptp4l (GM)
cat >/etc/systemd/system/ptp4l-gm.service <<'EOF'
[Unit]
Description=ptp4l Grandmaster (linuxptp)
After=network-online.target chrony.service systemd-timesyncd.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/ptp
# -i: interface, -4: UDP/IPv4, -E: E2E delay mechanism, -H/-S: hw/sw timestamping, -m: log to console
ExecStart=/usr/sbin/ptp4l -i ${PTP_IFACE} -4 -E ${PTP_TIMESTAMP_ARG} -m
Restart=on-failure
RestartSec=2
# Hardening
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# phc2sys (GM; steer PHC from system clock) – only when PHC exists
cat >/etc/systemd/system/phc2sys-gm.service <<'EOF'
[Unit]
Description=phc2sys for GM (discipline PHC from system clock)
After=ptp4l-gm.service
Requires=ptp4l-gm.service
ConditionPathExists=/etc/default/ptp

[Service]
Type=simple
EnvironmentFile=/etc/default/ptp
# Only meaningful if PHC exists; otherwise the command exits quickly.
ExecStart=/usr/sbin/phc2sys -s CLOCK_REALTIME -c ${PTP_IFACE} -O 0 -m
Restart=on-failure
RestartSec=2
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# ptp4l (Follower)
cat >/etc/systemd/system/ptp4l-slave.service <<'EOF'
[Unit]
Description=ptp4l Follower (linuxptp)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/ptp
# -i: interface, -s: slave-only, -4: UDP/IPv4, -E: E2E delay mechanism, -H/-S: hw/sw timestamping, -m: log to console
ExecStart=/usr/sbin/ptp4l -i ${PTP_IFACE} -s -4 -E ${PTP_TIMESTAMP_ARG} -m
Restart=on-failure
RestartSec=2
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# phc2sys (Follower)
cat >/etc/systemd/system/phc2sys-slave.service <<'EOF'
[Unit]
Description=phc2sys for Follower (discipline system clock from PHC or master)
After=ptp4l-slave.service
Requires=ptp4l-slave.service
ConditionPathExists=/etc/default/ptp

[Service]
Type=simple
EnvironmentFile=/etc/default/ptp
# If PHC exists: make system clock follow the NIC PHC
# If no PHC: fall back to auto mode where CLOCK_REALTIME is a slave from the best source
ExecStart=/bin/bash -c 'if [[ "${PTP_PHC_AVAILABLE}" == "1" ]]; then exec /usr/sbin/phc2sys -s "${PTP_IFACE}" -c CLOCK_REALTIME -O 0 -m; else exec /usr/sbin/phc2sys -a -r -m; fi'
Restart=on-failure
RestartSec=2
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo "[7/8] Enabling and starting services for mode: $MODE"
# stop anything previously enabled from the other mode
systemctl disable --now ptp4l-gm.service phc2sys-gm.service >/dev/null 2>&1 || true
systemctl disable --now ptp4l-slave.service phc2sys-slave.service >/dev/null 2>&1 || true

if [[ "$MODE" == "gm" ]]; then
  systemctl enable --now ptp4l-gm.service
  if [[ "$PHC_AVAILABLE" -eq 1 ]]; then
    systemctl enable --now phc2sys-gm.service
  else
    systemctl disable --now phc2sys-gm.service >/dev/null 2>&1 || true
  fi
else
  systemctl enable --now ptp4l-slave.service
  systemctl enable --now phc2sys-slave.service
fi

echo "[8/8] Quick sanity checks..."
sleep 2
echo "Current service state:"
systemctl --no-pager --full status ptp4l-${MODE}.service || true
[[ "$MODE" == "gm" ]] && systemctl --no-pager --full status phc2sys-gm.service || true
[[ "$MODE" == "slave" ]] && systemctl --no-pager --full status phc2sys-slave.service || true

echo
echo "Querying PTP datasets (pmc)..."
pmc -u -b 0 "GET CURRENT_DATA_SET" "GET PARENT_DATA_SET" || true

cat <<EOF

Done.

- Mode: ${MODE^^}
- Interface: $IFACE
- PHC available: $PHC_AVAILABLE

Useful commands:
  journalctl -u ptp4l-${MODE} -f
  journalctl -u phc2sys-${MODE} -f
  pmc -u -b 0 "GET TIME_STATUS_NP" "GET CURRENT_DATA_SET"

If you change NICs or want a different interface, edit /etc/default/ptp and run:
  sudo systemctl daemon-reload
  sudo systemctl restart ptp4l-${MODE} phc2sys-${MODE}
EOF
