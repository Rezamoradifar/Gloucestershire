"""Pair a private Global administrator and an optional Telegram announcement channel."""
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ENV = Path('/etc/globaldroptrade/portfolio-telegram.env')
DROPIN = Path('/etc/systemd/system/globaldroptrade-api.service.d/50-portfolio-telegram.conf')
PROFILES = Path('/opt/globaldroptrade-api/current/server/v3-history-profiles.json')
SERVICE = 'globaldroptrade-api'


def write_private(path, data, mode):
    if path.is_symlink() or path.parent.resolve() != path.parent:
        raise ValueError('Unexpected configuration path.')
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def telegram(token, method, **params):
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/' + method,
                                     data=json.dumps(params).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=18) as response:
            result = json.load(response)
        if result.get('ok'):
            return result['result']
    except urllib.error.HTTPError as error:
        raise ValueError(f'Telegram rejected {method} (HTTP {error.code}). Check the chat and bot permissions.') from None
    except (OSError, ValueError):
        pass
    raise ValueError('Could not verify Telegram ' + method + '.')


def pair(token, bot, username):
    if telegram(token, 'getWebhookInfo').get('url'):
        raise ValueError('This bot already uses a webhook. Enter the private numeric chat ID or use a dedicated Global bot.')
    code = secrets.token_urlsafe(18)
    print('Open this link in the intended administrator account and press Start within two minutes.')
    print('https://t.me/' + bot + '?start=' + code, flush=True)
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        for update in telegram(token, 'getUpdates', limit=100, timeout=3):
            msg = update.get('message', {})
            sender, chat = msg.get('from', {}), msg.get('chat', {})
            if (msg.get('text') == '/start ' + code and chat.get('type') == 'private'
                    and sender.get('id') == chat.get('id') and not sender.get('is_bot')
                    and (not username or sender.get('username', '').lower() == username)):
                return str(chat['id'])
        time.sleep(2)
    raise ValueError('No matching private start message was received. Use the private numeric chat ID if the bot already has pending updates.')


def configure():
    if os.geteuid() or not sys.stdin.isatty():
        raise ValueError('Run interactively as root on the Global API server.')
    if not (PROFILES.parent/'portfolio-telegram.mjs').is_file():
        raise ValueError('Install the portfolio notifications release first.')
    profiles = [p for p in json.loads(PROFILES.read_text()) if p.get('chainId') == 97
                and p.get('status') == 'VERIFIED_PORTFOLIO_TESTNET_ONLY']
    if len(profiles) != 1 or not re.fullmatch('0x[0-9a-fA-F]{40}', profiles[0]['vault']):
        raise ValueError('The installed primary portfolio profile could not be verified.')
    vault = profiles[0]['vault'].lower()
    current = {}
    for path in [ENV, DROPIN]:
        if path.is_symlink() or path.parent.resolve() != path.parent:
            raise ValueError('Unexpected configuration path.')
        if path.exists() and (not path.is_file() or path.stat().st_uid or path.stat().st_mode & (0o077 if path == ENV else 0o022)):
            raise ValueError('Review the existing configuration permissions.')
    directive = ('[Service]\nEnvironmentFile=' + str(ENV) + '\n').encode()
    if DROPIN.exists() and DROPIN.read_bytes() != directive:
        raise ValueError('The Telegram service configuration has local changes.')
    if ENV.exists():
        current = dict(line.split('=', 1) for line in ENV.read_text().splitlines() if line)
    token = getpass.getpass('Global bot token (Enter to keep the configured token): ').strip() or current.get('GLOBAL_TELEGRAM_BOT_TOKEN', '')
    if not re.fullmatch(r'\d+:[A-Za-z0-9_-]{25,100}', token):
        raise ValueError('Enter a valid BotFather token.')
    bot = telegram(token, 'getMe')
    if not bot.get('is_bot'):
        raise ValueError('This identity is not a bot.')
    print('Verified Global bot: @' + bot['username'])
    same_bot = current.get('GLOBAL_TELEGRAM_BOT_TOKEN','').partition(':')[0] == token.partition(':')[0]
    previous_admin = current.get('GLOBAL_TELEGRAM_ADMIN_CHAT_ID','') if same_bot else ''
    previous_channel = current.get('GLOBAL_TELEGRAM_CHANNEL_ID','') if same_bot else ''
    print('Admin: enter a private numeric chat ID or @username to pair. Enter keeps the current ID or starts pairing.')
    admin = input('Administrator: ').strip() or previous_admin
    if not re.fullmatch(r'[1-9]\d{0,15}', admin):
        if admin and not re.fullmatch(r'@[a-zA-Z0-9_]{5,32}', admin):
            raise ValueError('Enter a positive private ID or @username.')
        admin = pair(token, bot['username'], admin.lstrip('@').lower())
    chat = telegram(token, 'getChat', chat_id=admin)
    if chat['type'] != 'private' or str(chat['id']) != admin:
        raise ValueError('A verified private administrator chat is required.')
    print('Private recipient:', chat.get('first_name', ''), '@'+chat['username'] if chat.get('username') else '', 'ID', admin)
    channel = input('Channel @username or -100 ID (Enter keeps the configured destination): ').strip() or previous_channel
    if channel:
        if not re.fullmatch(r'(@[a-zA-Z0-9_]{5,32}|-100\d{6,13})', channel):
            raise ValueError('Enter an announcement channel username or ID.')
        destination = telegram(token, 'getChat', chat_id=channel)
        channel = str(destination['id'])
        rights = telegram(token, 'getChatMember', chat_id=channel, user_id=bot['id'])
        if destination['type'] != 'channel' or not re.fullmatch(r'-100\d{6,13}', channel) or rights.get('status') != 'administrator' or not rights.get('can_post_messages'):
            raise ValueError('Add this bot as a channel administrator with Post Messages permission first.')
        print('Announcement channel:', destination.get('title'), 'ID', channel)
    if input('Apply to these destinations? [y/N] ').strip().lower() != 'y':
        return
    values = {'GLOBAL_TELEGRAM_VAULT':vault,'GLOBAL_TELEGRAM_BOT_TOKEN':token,
              'GLOBAL_TELEGRAM_ADMIN_CHAT_ID':admin,'GLOBAL_TELEGRAM_CHANNEL_ID':channel}
    before = ENV.read_bytes() if ENV.exists() else None
    had_dropin = DROPIN.exists()
    DROPIN.parent.mkdir(mode=0o755, exist_ok=True)
    try:
        write_private(ENV, ''.join(k+'='+v+'\n' for k,v in values.items()).encode(), 0o600)
        write_private(DROPIN, directive, 0o644)
        subprocess.run(['systemctl','daemon-reload'], check=True)
        subprocess.run(['systemctl','restart',SERVICE], check=True)
        subprocess.run(['systemctl','is-active','--quiet',SERVICE], check=True)
    except (OSError, subprocess.CalledProcessError):
        if before is None:
            ENV.unlink(missing_ok=True)
        else:
            write_private(ENV,before,0o600)
        if not had_dropin:
            DROPIN.unlink(missing_ok=True)
        subprocess.run(['systemctl','daemon-reload'])
        subprocess.run(['systemctl','restart',SERVICE])
        raise ValueError('Activation failed. Previous settings restored.') from None
    telegram(token,'sendMessage',chat_id=admin,text='Global Drop Trade admin notifications are connected.\nhttps://globaldroptrade.com/#dashboard/admin-notifications')
    print('Telegram confirmed the private admin message. Publish channel content from Admin panel → Announcements.')


if __name__ == '__main__':
    try:
        configure()
    except (ValueError, OSError, EOFError, KeyboardInterrupt) as error:
        sys.exit(str(error) or 'Setup interrupted.')
