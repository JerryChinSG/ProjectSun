# Hosting Crux on your own server

These steps assume Ubuntu or Debian with nginx, serving Crux at `crux.jclife.online`.
Run them on the server over SSH.

## 1. Point the subdomain at the server

In IONOS: Domains & SSL → jclife.online → **DNS** → add an **A record** with host `crux`
and the same IP address your other subdomain uses.

## 2. Install Node 20 or newer (skip if `node -v` already shows v20.12+)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## 3. Get the code

```bash
sudo useradd --system --home-dir /opt/crux --shell /usr/sbin/nologin crux
sudo mkdir -p /opt/crux && sudo chown crux: /opt/crux
sudo -u crux git clone -b ccr-e158ecf7-f0v2ss https://github.com/JerryChinSG/ProjectSun.git /opt/crux
cd /opt/crux && sudo -u crux npm install --omit=dev
```

If the repository is private, git will ask for a username and a GitHub personal access token.

## 4. Settings

```bash
sudo -u crux cp .env.example .env
sudo -u crux nano .env
```

Set these and save:

```
ANTHROPIC_API_KEY=sk-ant-...      # from console.anthropic.com
BUDGET_USD=100
PORT=3210
APP_PASSWORD=pick-a-long-password
```

Leave `HOST` unset: the app then listens only on the server itself and nginx is the way in.

## 5. Run it as a service

```bash
sudo cp deploy/crux.service /etc/systemd/system/crux.service
sudo systemctl daemon-reload && sudo systemctl enable --now crux
systemctl status crux --no-pager        # should say "active (running)"
```

## 6. Put nginx and HTTPS in front

```bash
sudo cp deploy/nginx-crux.conf /etc/nginx/sites-available/crux
sudo ln -s /etc/nginx/sites-available/crux /etc/nginx/sites-enabled/crux
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d crux.jclife.online
```

Open https://crux.jclife.online. The browser asks for a login: any username, and the
`APP_PASSWORD` you chose.

## Updating later

```bash
cd /opt/crux && sudo -u crux git pull && sudo -u crux npm install --omit=dev && sudo systemctl restart crux
```

Your topics live in `/opt/crux/data` and are not touched by updates. Back that folder up if you care about them.

## If something is off

- `journalctl -u crux -n 50 --no-pager` shows the app's log.
- Replies arrive all at once instead of streaming: the `proxy_buffering off` line is missing from the nginx site.
- "No web search on this key" when opening a topic: enable web search for the organisation in the Anthropic Console.
