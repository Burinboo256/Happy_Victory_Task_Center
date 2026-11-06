# ตั้งค่าสรุป LINE — Happy Victory Rinlyn Task Center

## ลิงก์ส่งงานใหม่สำหรับ Rich Menu

ตั้งพื้นที่ปุ่ม “ส่งงานใหม่” เป็น **ลิงก์ / URI** แล้ววาง URL นี้:

```text
https://script.google.com/macros/s/AKfycbxyQsNe8I4psZUgv0lcIzUZKDWj8Yb_sUCcRllxGD8Hj9F3WF3iMEhgoh7P85UR2zTp/exec?view=create&openExternalBrowser=1
```

- `view=create` เปิดฟอร์มส่งงานใหม่โดยตรง และกลับมาที่ฟอร์มหลัง Google Login ในแท็บเดิม
- `openExternalBrowser=1` ให้ LINE เปิดในเบราว์เซอร์ภายนอก ตาม [คู่มือ LINE](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/#opening-a-url-in-an-external-browser)
- ใช้ได้กับฟอร์มบนมือถือและคอมพิวเตอร์; ปิดฟอร์มเพื่อกลับไปดู Dashboard ได้
- ผู้ใช้ยังต้องอยู่ใน Users, Active=true และมีสิทธิ์เข้า Google OAuth ของโปรเจกต์ (ขณะนี้เป็น Testing จึงต้องเพิ่ม Test users ด้วย)
- Agent ส่งงานของตนเอง; Admin / Secretary ต้องเลือก Agent จริงก่อนส่ง ไม่ต้องสร้าง LIFF หรือเปิดระบบส่งข้อความเพื่อใช้ลิงก์นี้

ทดสอบจาก Rich Menu บนโทรศัพท์: เปิดลิงก์ → Login → ฟอร์มส่งงานใหม่ → ตรวจชื่อบัญชีและข้อมูลก่อนส่ง การทดสอบผ่านเบราว์เซอร์คอมพิวเตอร์ไม่ยืนยันพฤติกรรมแอป LINE บนอุปกรณ์จริง

ระบบส่งผ่าน **แชตส่วนตัว** ของ LINE Official Account ทุกวัน เวลาเป้าหมาย **08:00 และ 18:00 น. Asia/Bangkok** ผู้เป็น `Admin` (เจ้าของระบบ) และ `Secretary` รับภาพรวม ส่วน `Agent` รับเฉพาะงานที่ตัวเองเป็นเจ้าของ

รุ่นนี้เพิ่มโค้ดครบแล้ว แต่ยังไม่ได้สร้าง OA / credentials / ติดตั้ง Trigger หรือส่งข้อความจริงในบัญชีเจ้าของ ต้องตั้งค่าด้านล่างและทดสอบกับ Base จริงก่อนเปิดใช้

## 1. เตรียม Airtable

เพิ่ม record ของคุณใน `Users` เป็น Role **Admin** และ Active=true ส่วนเลขาฯ เป็น **Secretary** Agent แต่ละคนเป็น **Agent** ห้ามตั้ง Agent เป็น Admin เพื่อเปิดรับสรุป เพราะ Admin มีสิทธิ์ดูงานทั้งหมดด้วย

เพิ่มฟิลด์ต่อไปนี้โดยใช้ชื่อและชนิดให้ตรง:

### Users

| Field | Type | ใช้งาน |
|---|---|---|
| LINE User ID | Single line text | ระบบเติมหลังเจ้าของบัญชีกดเชื่อม LINE |
| LINE Notifications | Checkbox | เปิด / ปิดการรับสรุป เริ่มต้นเป็นปิด |

LINE User ID รูปแบบ `U` ตามด้วยอักขระ hex 32 ตัว เป็นคนละค่ากับ LINE ID สำหรับค้นหาเพื่อน แต่ละบัญชี LINE ผูกกับสมาชิกได้คนเดียว ห้ามใช้ Group ID เพื่อรักษาสิทธิ์เฉพาะงานของ Agent

### Notifications

| Field | Type | ใช้งาน |
|---|---|---|
| Channel | Single select | เพิ่ม option `LINE` โดยคง `Email` เดิม |
| Event Type | Single select | มี option `Daily Summary` |
| Delivery Status | Single select | `Pending`, `Sending`, `Sent`, `Failed` |
| Digest Date | Date ไม่มีเวลา | วันที่ของรายงานตามเวลาไทย |
| Digest Round | Single select | `Morning`, `Evening` |
| LINE User ID | Single line text | สำเนาผู้รับ ณ เวลาสร้างรายงาน |
| LINE Role | Single line text | สิทธิ์ ณ เวลาสร้างรายงาน |
| LINE Retry Key | Single line text | UUID ใช้ป้องกันคำขอส่งซ้ำ |
| Scope Fingerprint | Single line text | ตรวจว่าชุดงานที่ผู้รับมีสิทธิ์ไม่ได้เปลี่ยน |
| Delivery Started At | Date with time | เวลาเริ่มส่งครั้งแรก |
| Last Error | Long text | เหตุผลที่ต้องตรวจสอบ / ส่งไม่สำเร็จ |

คงฟิลด์เดิม `Operation Key`, `Task`, `Recipient`, `Message`, `Sent At` ตาม [schema](database-schema.md) ไม่ต้องย้ายข้อมูลเดิม

## 2. สร้างหรือใช้ LINE OA เดิม

1. เปิด [LINE Official Account Manager](https://manager.line.biz/) ด้วยบัญชีเจ้าของ และสร้าง OA เช่น **Happy Victory Rinlyn** หรือเลือก OA ของทีมที่มีอยู่
2. ใน Settings → Messaging API เปิดใช้งาน Messaging API และเลือก Provider ขององค์กร
3. เปิด [LINE Developers Console](https://developers.line.biz/console/) แล้วเลือก Provider เดียวกัน จะพบ Messaging API channel ของ OA
4. ใน Messaging API tab ออก **Channel access token** แล้วเก็บใน Script Properties ชื่อ `LINE_CHANNEL_ACCESS_TOKEN` หากใช้ token ที่มีวันหมดอายุ ต้องต่ออายุก่อนหมดอายุ
5. จดลิงก์ / QR เพิ่มเพื่อนของ OA ให้คุณ เลขาฯ และ Agent ทุกคนเพิ่ม OA นี้เป็นเพื่อน

อย่าใช้ token ของ LINE Notify เดิม ระบบนี้ใช้ Messaging API ของ OA การตั้งค่าบัญชี / ยอมรับข้อตกลง / สิทธิ์ใน Console ให้เจ้าของทำด้วยบัญชีตัวเอง

## 3. สร้าง LINE Login channel สำหรับผูกผู้รับ

ต้องสร้าง **LINE Login channel อีกหนึ่ง channel ภายใต้ Provider เดียวกับ Messaging API** การอยู่ Provider เดียวกันทำให้ LINE User ID จาก Login ตรงกับผู้รับ Messaging API

1. LINE Developers Console → Provider ขององค์กร → Create a new channel → **LINE Login**
2. ใส่ชื่อแอปและข้อมูลตาม Console เลือกประเภท **Web app**
3. ตั้ง Callback URL ใน LINE Login tab เป็น Web App URL ของ Apps Script เดิมที่ลงท้าย `/exec` ตัวอย่าง:

   ```text
   https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   ```

4. ใน Basic settings ตั้ง **Linked OA** เป็น OA ที่จะส่งสรุป เพื่อแสดงตัวเลือกเพิ่มเพื่อนเมื่อเชื่อมบัญชี
5. นำ **Channel ID** และ **Channel secret ของ LINE Login** ไปตั้ง Script Properties ด้านล่าง ค่าเหล่านี้เป็นคนละชุดกับ Messaging API token
6. ระหว่าง channel อยู่สถานะ Developing ผู้ทดสอบต้องมีสิทธิ์เข้าถึงตามการตั้งค่าของ LINE หากจะให้ Agent ทั้งทีมใช้ ให้ตรวจข้อมูลแอป / callback / policy URLs ที่ Console กำหนด แล้วเปลี่ยนสถานะ LINE Login เป็น Published เมื่อพร้อม

ใช้สิทธิ์ `profile` เพื่ออ่าน LINE User ID เท่านั้น ไม่ขออีเมล LINE ไม่ใช้ LINE เป็นตัวล็อกอินหลักของ Task Center; ผู้ใช้ยังต้องล็อกอิน Google และมีบัญชี Users ที่ได้รับอนุญาตก่อนเชื่อม

**ไม่ต้องตั้ง Webhook URL สำหรับฟังก์ชันสรุปรุ่นนี้** ระบบใช้ LINE Login ผูกผู้ใช้ แล้วใช้ push message ส่งออก หาก OA มี webhook สำหรับบริการอื่นอยู่แล้ว ให้คงการตั้งค่าของบริการนั้น ห้ามวาง Web App `/exec` นี้เป็น webhook เพราะไม่ได้ติดตั้งตัวรับ webhook

## 4. ตั้ง Script Properties และ Deploy

| Key | Value |
|---|---|
| LINE_CHANNEL_ACCESS_TOKEN | Token ของ **Messaging API** ของ OA ที่จะส่ง |
| LINE_LOGIN_CHANNEL_ID | Channel ID ของ **LINE Login** |
| LINE_LOGIN_CHANNEL_SECRET | Channel Secret ของ **LINE Login** |
| ENABLE_LINE_NOTIFICATIONS | `false` ระหว่างตั้งค่า → `true` เมื่อตรวจครบ |
| WEB_APP_URL | URL Apps Script `/exec` เดิม ต้องตรงกับ Callback URL |

เก็บค่าลับใน Apps Script → Project Settings → Script Properties เท่านั้น ไม่ต้องส่งมาในแชตหรือใส่ในไฟล์ ZIP

นำไฟล์ `.gs` และ HTML ที่อัปเดตแล้วใน `apps-script/` ขึ้นโปรเจกต์ โดยเพิ่ม `LineAuth.gs`, `LineSummary.gs` ด้วย แล้ว Deploy → Manage deployments → Edit → **New version** → Deploy โดยใช้ deployment เดิม

## 5. ให้แต่ละคนเชื่อม LINE ของตัวเอง

1. เปิด Task Center `/exec` และเข้าสู่ระบบ Google ของตัวเอง
2. กดปุ่ม **LINE** ที่แถบด้านบน → **เชื่อม LINE และเปิดรับสรุป** → **ดำเนินการต่อที่ LINE**
3. ตรวจว่าล็อกอิน LINE ของตัวเอง แล้วยินยอมการอ่านโปรไฟล์และเพิ่ม OA เป็นเพื่อน
4. กลับสู่ Task Center ในแท็บเดิม ระบบจะผูก LINE User ID ที่เซิร์ฟเวอร์อ่านจาก LINE เข้ากับ Users ของบัญชี Google ที่เริ่มเชื่อม และเปิด LINE Notifications
5. ตรวจใน Users ว่าผู้ใช้แต่ละคนมี LINE User ID ไม่ซ้ำ และ Role ถูกต้อง

หน้าเว็บแสดงเพียงสถานะเชื่อมต่อ ไม่ส่ง LINE User ID ของสมาชิกคนอื่นให้ browser ถ้าต้องการหยุดรับ ผู้ใช้กด LINE → **หยุดรับสรุป** ได้ หรือเจ้าของปิด LINE Notifications / Active ใน Users

การใช้ Google OAuth / LINE Login ผ่าน Apps Script redirect และ browser storage ยังต้องทดสอบบน deployment จริง เปิดจาก browser ปกติและใช้แท็บเดิม หาก session Google หมดอายุ ให้ล็อกอินใหม่ก่อนเริ่มเชื่อม LINE ใหม่

## 6. เปิดตารางเวลา 08:00 และ 18:00

เมื่อทุกคนเชื่อมแล้ว:

1. ตั้ง `ENABLE_LINE_NOTIFICATIONS=true`
2. จาก Apps Script Editor เลือก `installLineSummaryTrigger_` แล้วกด Run ในบัญชีเจ้าของ อนุญาตสิทธิ์ Google เมื่อระบบขอ
3. ตรวจหน้า Triggers ให้มี `runLineSummarySchedule_` แบบ Time-driven **ทุก 5 นาที** เพียงหนึ่งรายการ การรันตัวติดตั้งซ้ำจะเปลี่ยนเฉพาะ trigger ของ LINE และคง trigger อีเมลเดิม

Trigger ตรวจเวลาไทยและทำงานเฉพาะรอบ 08:00–08:59 และ 18:00–18:59 โดยส่งเมื่อถึง tick แรกหลังเวลาเป้าหมาย เมื่อรอบนั้นส่งครบแล้วจะไม่เรียก Airtable ซ้ำใน tick ที่เหลือ รอบถัดไปจะสร้างรายงานใหม่

โดยปกติคาดหวังการเริ่มส่งใกล้ 08:00 / 18:00 เช่น 08:00–08:05 แต่ Google อาจเรียก trigger ช้ากว่านั้น จึงไม่รับประกันนาทีที่ส่ง หาก Google ไม่เรียกภายในหน้าต่างของรอบนั้นจะข้ามรอบ ไม่ส่งรายงานเช้าย้อนหลังในตอนเย็น

หากต้องการตรวจตอนอยู่ในช่วงรอบ ให้ Run `runLineSummarySchedule_` จาก Editor ได้ จะใช้คิว / key เดิมและไม่สร้างรอบซ้ำ **ฟังก์ชันนี้ส่งจริงเมื่อเปิด ENABLE_LINE_NOTIFICATIONS**

## 7. เนื้อหาสรุปและสิทธิ์

ทั้งสองรอบมี 4 หมวด โดยรอบเย็นสรุปความคืบหน้าจนถึงเวลาส่ง:

- งานกำหนดส่งวันนี้: Due Date ตรงวันนี้ และยังไม่ Completed / Cancelled
- งานต้องติดตาม: Next Follow-up วันนี้หรือก่อนหน้า และงานยังเปิดอยู่
- งานคงค้าง: งานเปิดทั้งหมด พร้อมจำนวนเกินกำหนด
- เสร็จวันนี้: สถานะปัจจุบัน Completed และ Completed At อยู่ในวันไทยของรายงาน

ส่งจำนวนครบทุกหมวด พร้อมตัวอย่างสูงสุด **4 รายการต่อหมวด** และลิงก์เปิด Task Center เมื่อมีมากกว่านั้นจะแจ้งจำนวนที่เหลือ หมวดอาจซ้ำกันเพราะมองคนละเงื่อนไข แม้ไม่มีงานก็ส่งสรุป 0 งานตามรอบ

ชื่อ Agent ปรากฏในภาพรวมของ Admin / Secretary ส่วน Agent ได้เฉพาะชื่อและงานของตัวเอง ไม่มี Description, internal comments, follow-up notes หรือข้อมูลไฟล์แนบในข้อความ LINE

งานใหม่ / การเปลี่ยนสถานะหลังเวลาสรุปจะเข้า Dashboard ทันทีและเข้าสรุปรอบถัดไป รายงานไม่ติดตามงานหลัง 18:00 เพื่อแก้ข้อความที่ส่งไปแล้ว

## 8. โควตาและการตรวจส่ง

ข้อความเป็น push message ในแชตส่วนตัว หากมีคุณ 1 คน + เลขาฯ 1 คน + Agent 10 คน = **12 คน × 2 รอบ × 30 วัน = ประมาณ 720 ข้อความต่อเดือน** ไม่รวมข้อความอื่นของ OA ต้องตรวจแพ็กเกจและโควตาปัจจุบันใน OA Manager ก่อนเปิดใช้

กระบวนการคิว การตรวจสิทธิ์ และบันทึกผลใช้ Airtable หลาย request ต่อรายงาน จึงอาจใช้ API หลายพันครั้งต่อเดือนร่วมกับหน้าเว็บ ตรวจแพ็กเกจ Airtable และโควตา Google ของบัญชีด้วย

ดู Notifications กรอง Channel=LINE / Digest Date=วันนี้:

- Pending: รอส่ง หรือรอ retry หลังปัญหาเครือข่าย / LINE 5xx
- Sending: เริ่มส่งแล้ว หาก script ถูกตัดกลางคันรอบถัดไป retry ด้วยผู้รับ ข้อความ และ key เดิม
- Sent: LINE **รับคำขอแล้ว** ไม่ได้ยืนยันว่าผู้รับอ่านหรือได้รับจริง ผู้ที่บล็อก OA อาจไม่ได้รับแม้ API ตอบสำเร็จ
- Failed: การตั้งค่า / โควตา / สิทธิ์ / ผู้รับเปลี่ยน หรือรายงานหมดรอบ ต้องตรวจสาเหตุก่อน

ใช้ `X-Line-Retry-Key` เดิมตั้งแต่ครั้งแรก เพื่อป้องกันคำขอส่งซ้ำ กรณี LINE ตอบ 409 จะนับสำเร็จเฉพาะเมื่อมี accepted request ID ยืนยันแล้ว การ retry อัตโนมัติทำภายในหน้าต่างรอบเดียวกันและไม่เกินอายุ retry key

HTTP 401 / 403 ให้ตรวจ token, 400 ตรวจข้อมูล, 429 ตรวจโควตา / rate limit ระบบไม่วน retry 4xx อัตโนมัติ เมื่อแก้สาเหตุและยืนยันให้ส่งต่อแล้ว ให้เปลี่ยนรายการที่เหมาะสมกลับเป็น Pending และ Run `resumeLineSummaryRound_` ภายในช่วงรอบนั้น โดย **คง Message / LINE User ID / LINE Retry Key เดิม**

ห้ามเปลี่ยนผู้รับหรือข้อความของงานที่เคยเริ่มส่งด้วย retry key เดิม หากผู้ใช้ปิดรับ เปลี่ยน role, LINE ID หรือชุดงานที่มีสิทธิ์เปลี่ยน ระบบยกเลิกคิวนั้นและรอรายงานรอบถัดไป

หยุดระบบ LINE ด้วย `ENABLE_LINE_NOTIFICATIONS=false` หรือ Run `removeLineSummaryTrigger_` ซึ่งปิด flag และลบเฉพาะ trigger LINE

## 9. ทดสอบก่อนเปิดทั้งทีม

เริ่มด้วย Base ทดสอบและบัญชีตัวเองก่อน ตรวจ 08:00 และ 18:00 จริงอย่างละรอบ จากนั้นเพิ่มเลขาฯ และ Agent ตัวอย่างสองคน ตรวจว่า Agent แต่ละคนได้รับเฉพาะงานตนเอง ทดสอบข้อความซ้ำ / ปิดรับ / Active=false / วันเสร็จใกล้เที่ยงคืนไทย แล้วจึงเปิดทั้งทีม

## เอกสาร LINE และ Google

- [เปิด Messaging API จาก LINE OA](https://developers.line.biz/en/docs/messaging-api/getting-started/)
- [LINE Login แบบเว็บและ callback](https://developers.line.biz/en/docs/line-login/integrate-line-login/)
- [LINE User ID และ Provider](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)
- [Push messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [Retry key และข้อจำกัดการ retry](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [แพ็กเกจและการนับข้อความ](https://developers.line.biz/en/docs/messaging-api/pricing/)
- [Google Apps Script time-driven triggers](https://developers.google.com/apps-script/guides/triggers/installable)
