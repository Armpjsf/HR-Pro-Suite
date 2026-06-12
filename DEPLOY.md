# คู่มือ Deploy บน Oracle Cloud Always Free Tier

ใช้เวลาประมาณ 1-2 ชั่วโมง ค่าใช้จ่าย 0 บาท

---

## ขั้นที่ 1: สมัคร Oracle Cloud

1. ไปที่ https://www.oracle.com/cloud/free/ → กด **Start for free**
2. กรอกข้อมูล เลือก **Home Region** ที่ใกล้ไทย เช่น **Singapore** หรือ **Japan (Tokyo)**
   - ⚠️ Home Region เปลี่ยนทีหลังไม่ได้ และ VM ฟรีสร้างได้เฉพาะใน Home Region
3. ยืนยันบัตรเครดิต/เดบิต (ตัดยอด ~1 USD แล้วคืน ไม่มีการเรียกเก็บถ้าใช้แค่ Always Free)
4. รอบัญชี active (อาจใช้เวลาหลายชั่วโมง)

## ขั้นที่ 2: สร้าง VM (Ampere A1 — Always Free)

1. เมนู ☰ → **Compute → Instances → Create instance**
2. ตั้งชื่อ เช่น `hr-chatbot`
3. **Image**: เลือก **Ubuntu 24.04** (aarch64)
4. **Shape**: กด Change shape → **Ampere → VM.Standard.A1.Flex**
   - กำหนด 2 OCPU / 12 GB RAM ก็เหลือพอ (โควต้าฟรีรวมสูงสุด 4 OCPU / 24 GB)
   - ต้องเห็นป้าย **Always Free-eligible**
5. **SSH keys**: เลือก Generate key pair → **ดาวน์โหลด private key เก็บไว้** (ไฟล์ .key)
6. กด **Create**
   - ⚠️ ถ้าขึ้น "Out of capacity" แสดงว่าเครื่อง ARM ใน region เต็ม — ลองกดสร้างใหม่วันละ 2-3 ครั้ง หรือเปลี่ยน Availability Domain มักได้ภายในไม่กี่วัน
7. จด **Public IP** ของเครื่องไว้

## ขั้นที่ 3: เปิด Port (ต้องทำ 2 ชั้น!)

Oracle ปิด port ไว้ทั้งในระบบ cloud และในตัว OS — ต้องเปิดทั้งคู่

**ชั้นที่ 1 — Security List (หน้าเว็บ Oracle):**

1. หน้า Instance → กดลิงก์ **Subnet** → กด **Security List** (Default)
2. **Add Ingress Rules** เพิ่ม 2 กฎ:
   - Source CIDR `0.0.0.0/0`, Protocol TCP, Destination Port `80`
   - Source CIDR `0.0.0.0/0`, Protocol TCP, Destination Port `443`

**ชั้นที่ 2 — iptables ในเครื่อง (ทำหลัง SSH เข้าไปแล้ว ขั้นที่ 4):**

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## ขั้นที่ 4: SSH เข้าเครื่อง + ติดตั้ง Docker

```bash
# จากเครื่องคุณ (Windows ใช้ PowerShell ได้เลย)
ssh -i path\to\private.key ubuntu@<PUBLIC_IP>
```

ติดตั้ง Docker:

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit   # ออกแล้ว ssh เข้าใหม่ เพื่อให้สิทธิ์ docker มีผล
```

## ขั้นที่ 5: นำโค้ดขึ้นเครื่อง

ทางเลือก ก) ถ้าโค้ดอยู่บน GitHub:

```bash
git clone https://github.com/<คุณ>/hr-ai-chatbot.git
cd hr-ai-chatbot
```

ทางเลือก ข) อัพโหลดตรงจากเครื่องคุณ (PowerShell ในโฟลเดอร์โปรเจกต์):

```powershell
scp -i path\to\private.key -r . ubuntu@<PUBLIC_IP>:~/hr-ai-chatbot
```

(ไม่ต้องอัพ `node_modules` — ลบทิ้งก่อน หรือใช้ git จะสะอาดกว่า)

## ขั้นที่ 6: ตั้งค่า + รัน

```bash
cd ~/hr-ai-chatbot
cp .env.example .env.local
nano .env.local    # ใส่ GEMINI_API_KEY, JWT_SECRET (และ LINE keys ถ้าใช้)
```

สร้าง JWT_SECRET แบบสุ่ม:

```bash
openssl rand -hex 32
```

รัน:

```bash
docker compose up -d --build
docker compose logs -f   # ดู log (Ctrl+C เพื่อออก)
```

ทดสอบ: เปิด `http://<PUBLIC_IP>:3000` ควรเห็นหน้า login
(ถ้ายังไม่ได้เปิด port 3000 ใน Security List ให้ทดสอบจากในเครื่อง: `curl http://localhost:3000`)

## ขั้นที่ 7: โดเมน + HTTPS (จำเป็นถ้าใช้ LINE)

LINE webhook บังคับ HTTPS จึงต้องมีโดเมน (โดเมนฟรีใช้ DuckDNS ได้ หรือซื้อโดเมนถูก ๆ)

1. ชี้ DNS A record ของโดเมน → Public IP ของ VM
2. ใช้ **Caddy** เป็น reverse proxy (ออกใบรับรอง HTTPS ให้อัตโนมัติ):

แก้ `docker-compose.yml` เพิ่ม service caddy:

```yaml
services:
  hr-chatbot:
    build: .
    env_file:
      - .env.local
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    # ลบ ports: ออก — ให้เข้าผ่าน caddy เท่านั้น

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    restart: unless-stopped

volumes:
  caddy_data:
```

สร้างไฟล์ `Caddyfile`:

```
hr.yourdomain.com {
    reverse_proxy hr-chatbot:3000
}
```

แล้ว `docker compose up -d --build` ใหม่ → เปิด `https://hr.yourdomain.com` ได้เลย

## ขั้นที่ 8: ตั้งค่า LINE Bot

1. https://developers.line.biz/console/ → สร้าง **Messaging API channel**
2. คัดลอก **Channel secret** และออก **Channel access token** → ใส่ใน `.env.local` → `docker compose up -d` ใหม่
3. ตั้ง **Webhook URL**: `https://hr.yourdomain.com/api/line/webhook` → กด Verify → เปิด Use webhook
4. ปิด Auto-reply messages ในหน้า LINE Official Account Manager
5. พนักงานแอดเพื่อน แล้วพิมพ์ `ลงทะเบียน EMP001`

## ขั้นที่ 9: สำรองข้อมูลอัตโนมัติ

ข้อมูลทั้งหมดอยู่ในโฟลเดอร์ `data/` ตั้ง cron สำรองรายวัน:

```bash
crontab -e
# เพิ่มบรรทัดนี้ — สำรองทุกตี 2 เก็บย้อนหลัง 14 วัน
0 2 * * * cd ~/hr-ai-chatbot && tar czf ~/backups/data-$(date +\%Y\%m\%d).tar.gz data/ && find ~/backups -mtime +14 -delete
```

```bash
mkdir -p ~/backups
```

## การอัพเดทแอปภายหลัง

```bash
cd ~/hr-ai-chatbot
git pull                          # หรือ scp ไฟล์ใหม่ขึ้นมา
docker compose up -d --build      # ข้อมูลใน data/ ไม่หาย เพราะ mount ไว้นอก container
```

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| เข้าเว็บไม่ได้ | เช็ค port เปิดครบ 2 ชั้น (Security List + iptables) |
| Out of capacity ตอนสร้าง VM | เครื่อง ARM เต็ม — ลองใหม่หลายครั้ง/เปลี่ยน AD |
| LINE Verify ไม่ผ่าน | ต้องเป็น HTTPS และ container รันอยู่ (`docker compose ps`) |
| อัพโหลดเอกสารแล้วหายหลัง redeploy | เช็คว่า `volumes: ./data:/app/data` อยู่ใน compose |
| AI ไม่ตอบจากเอกสาร | เช็ค GEMINI_API_KEY ใน `.env.local` และดู `docker compose logs` |
