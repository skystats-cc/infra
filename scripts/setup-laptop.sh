#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu Server 24.04 laptop. Read it before running:
#   sudo bash scripts/setup-laptop.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
target_user="${SUDO_USER:?run via sudo from your normal user}"

echo "==> Updates + basics"
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw unattended-upgrades rclone

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Docker Engine + Compose plugin (official repo)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$target_user"
systemctl enable --now docker

echo "==> Keep running with the lid closed"
sed -i -E 's/^#?HandleLidSwitch=.*/HandleLidSwitch=ignore/; s/^#?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/; s/^#?HandleLidSwitchDocked=.*/HandleLidSwitchDocked=ignore/' /etc/systemd/logind.conf
systemctl restart systemd-logind

echo "==> Never sleep"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

echo "==> Firewall: SSH only (public traffic arrives via the Cloudflare tunnel)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

echo
echo "Done. Log out and back in (docker group), then follow README 'First deploy'."
echo "Also check the BIOS for 'Restore on AC power loss' and turn it on."
