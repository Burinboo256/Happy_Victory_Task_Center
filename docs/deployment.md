# ติดตั้งบน Google Apps Script

คู่มือนี้นำเว็บทั้งหมดขึ้น Google Apps Script และเชื่อม Airtable ของเจ้าของระบบ ไม่มีขั้นตอน Deploy ไปยังโฮสต์อื่น

สำหรับการย้ายไป Vercel ให้อ่าน [แผนพัฒนา](vercel-development-plan.md) และ [แผน Deploy / Cutover / Rollback](vercel-deployment-plan.md) ซึ่งยังเป็นแผนเตรียมงาน คู่มือนี้ยังใช้อ้างอิง production และ rollback ของระบบเดิม

## โปรเจกต์ที่เตรียมไว้

สร้าง [Happy Victory Rinlyn Task Center](https://script.google.com/home/projects/1ZmS7STMgpHOgEXF3cEup31io51rQtWa3vw2XIIhx7Y1mbvAePysi3CQs/edit) ในบัญชีเจ้าของแล้ว โค้ด production ใช้ `Code.gs` ที่รวม backend จาก `apps-script/*.gs` พร้อม `Index.html`, `Styles.html`, `Scripts.html` และ `appsscript.json` ตรวจเนื้อหาที่คัดลอกกลับจาก editor แล้วตรงกับต้นฉบับทั้ง 5 ไฟล์

ตั้ง V8 / Asia/Bangkok, Base/Table ID ทั้ง 6 ค่า, `AIRTABLE_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEB_APP_URL` และ flags ปิดอีเมล/LINE ใน Script Properties ครบแล้ว `checkDeployment` ผ่านและอ่าน Airtable จริงได้ทั้ง 5 ตาราง ยังไม่ได้สร้าง triggers

สร้าง [Google Cloud project สำหรับ OAuth](https://console.cloud.google.com/auth/clients?project=happy-victory-task-center) ชื่อ **Happy Victory Task Center** (`happy-victory-task-center`) แยกจากโปรเจกต์อื่นและตั้ง OAuth branding / Audience แบบ External แล้ว สร้าง PAT จำกัด `data.records:read` / `data.records:write` เฉพาะ Base นี้ เก็บ secret ใน Script Properties โดยตรง ไม่มีค่า secret ใน workspace

เผยแพร่แบบ Execute as Me / Anyone แล้ว ใช้ [Web App URL เดิม](https://script.google.com/macros/s/AKfycbxyQsNe8I4psZUgv0lcIzUZKDWj8Yb_sUCcRllxGD8Hj9F3WF3iMEhgoh7P85UR2zTp/exec) เป็นทั้ง `WEB_APP_URL` และ Authorized redirect URI ของ Web application client ชื่อ **Happy Victory Task Center — Apps Script**

เวอร์ชัน 2 แก้ JavaScript ที่ HTML Service ตัดตรง URL ภายใน template literal โดยใช้รูปแบบ regex และ HTML entity แทน slash คู่ใน markup ตรวจ response สาธารณะด้วย `node tools/check-deployment.mjs artifacts/deployed-response.html` แล้ว inline scripts ทั้ง 2 ชุด parse ผ่าน หน้า Login แสดงและ `startGoogleLogin` สร้างลิงก์ไป Google ได้จริง

เวอร์ชันปัจจุบัน **4** เพิ่ม `?view=create` สำหรับเปิดฟอร์มส่งงานใหม่โดยตรงและจำจุดหมายระหว่าง Google Login สำหรับ LINE Rich Menu ใช้ `?view=create&openExternalBrowser=1` ตาม [คู่มือ LINE OA](line-oa-setup.md#ลิงก์ส่งงานใหม่สำหรับ-rich-menu) ตรวจ response จริงด้วย `node tools/check-deployment.mjs artifacts/deployed-mobile-response.html` ผ่าน inline scripts ทั้ง 2 ชุด และเปรียบเทียบ frontend ทุกบรรทัดกับ source แล้วตรงกัน (ไม่รวมช่องว่างต้นและท้ายบรรทัด)

มี Admin แรก `ADMIN001` สำหรับบัญชีเจ้าของ และเพิ่มบัญชีนี้ใน OAuth Test users แล้ว ทดสอบ Google Login / callback / session / Dashboard และหน้าทีมบน deployment จริงผ่านแล้ว execution ของ `completeGoogleLogin` และ `api` สำเร็จ ซึ่งรวมการผูก Google Subject และเขียน Last Login ใน Users รายละเอียดบัญชีคงอยู่ใน Users ไม่บันทึกอีเมลหรือ record ID ของบุคคลใน repository สาธารณะ

OAuth ยังเป็น **External / Testing** สมาชิกทีมอื่นต้องมีทั้ง Users ที่ Active และสิทธิ์ Test users ก่อนทดสอบ Login ยังไม่มีเลขาฯ / Agent จริง จึงยังไม่ได้ทดสอบสร้างงานและสิทธิ์ข้ามบัญชีบน deployment จริง อีเมล / LINE แจ้งเตือนยังปิดไว้

## 1. เตรียม Airtable

สร้างหรือปรับตารางตาม [database-schema.md](database-schema.md) และเพิ่มเลขาฯ / Agent ที่เปิด Active แล้ว ตรวจว่า Linked Record แต่ละรายการลิงก์ได้เพียงหนึ่งรายการตาม schema

หากใช้สรุป LINE เช้า–เย็น ให้เพิ่มฟิลด์ Users / Notifications และตั้งค่าตาม [คู่มือ LINE OA](line-oa-setup.md) ด้วย

สร้าง Airtable Personal Access Token ที่มี `data.records:read`, `data.records:write` และอนุญาตเฉพาะ Base นี้ เก็บ Token ไว้ใช้ใน Script Properties ห้ามใส่ใน HTML หรือ repository

Base ID มีรูปแบบ `app…` ส่วน Table ID มีรูปแบบ `tbl…` ใช้ชื่อ Table ที่กำหนดไว้หรือใช้ Table ID ในการตั้งค่าได้ ลิงก์ invitation ไม่ใช่ API credential

Base เดิม `appDS1Ji5cqIohPq3` มีตารางใหม่ทั้ง 5 ตารางตาม schema และตรวจโครงสร้างแล้วเมื่อ 4 พฤศจิกายน 2026 ใช้ Tasks ID `tblD50c8x4jdMfFxL` และคัดลอก Table ID อื่นจาก [ค่าการเชื่อมต่อ Airtable](airtable-connection.md) ตารางเดิม Table 1 ไม่ใช่ Tasks ของแอปนี้ ยังต้องเพิ่ม Users จริงและตั้ง credentials ก่อนใช้งาน

## 2. สร้าง standalone Apps Script

เปิด [Google Apps Script](https://script.google.com/) ด้วยบัญชีเจ้าของระบบ → New project → ตั้งชื่อ **Happy Victory Rinlyn Task Center**

สร้าง Script files จากไฟล์ `.gs` ทั้งหมดใน `apps-script/` และสร้าง HTML files ชื่อ `Index`, `Styles`, `Scripts` จากไฟล์ชื่อเดียวกัน อย่านำ `preview/Demo.html` หรือ `dist/index.html` เข้าโปรเจกต์จริง

หากนำเข้าผ่านหน้า editor ใช้ `npm run package:apps-script` เพื่อเตรียมไฟล์ production 5 ไฟล์ใน `artifacts/apps-script/` ได้ โดย `Code.gs` รวม backend ทั้งหมดไว้แล้ว เลือกใช้ backend แบบรวมไฟล์หรือแยกไฟล์อย่างใดอย่างหนึ่ง เพื่อไม่ให้ประกาศฟังก์ชันซ้ำ ชุดไฟล์มี `SHA256SUMS.txt` สำหรับตรวจต้นฉบับและไม่มี demo หรือ credentials

ใน Project Settings เปิด Show `appsscript.json` manifest file แล้ววาง manifest ที่เตรียมไว้ ตั้ง Timezone เป็น `Asia/Bangkok`

manifest ต้องมี `userinfo.email` สำหรับตรวจ Google active/effective user ของคำสั่งตั้งค่า นอกเหนือจาก `script.external_request`, `script.send_mail` และ `script.scriptapp` ตาม [Session authorization](https://developers.google.com/apps-script/reference/base/session) สิทธิ์เหล่านี้เป็นสิทธิ์ของบัญชีผู้ Deploy ส่วน Google Login ของทีมใช้ `openid email profile` แยกต่างหาก การใส่ scopes ในไฟล์ยังไม่ใช่การอนุญาตสิทธิ์จริง เจ้าของต้องยืนยันในหน้า Google

หากใช้ clasp อยู่แล้ว ให้ตั้ง `.clasp.json` ที่ root โปรเจกต์ โดยใส่ `scriptId` ของคุณและ `rootDir: "apps-script"` แล้วตรวจรายการก่อน push ไม่ต้องส่ง `.clasp.json` หรือ credentials กลับมาในแชต

ใน workspace นี้เตรียม `.clasp.json` ชี้ไปโปรเจกต์ใหม่แล้วและไฟล์ถูก ignore ไม่มี clasp login credentials การนำเข้าครั้งนี้ใช้หน้า editor ไม่ได้ใช้ clasp push

## 3. ตั้ง Script Properties

Project Settings → Script Properties → Add script property

| Key | Value |
|---|---|
| AIRTABLE_TOKEN | PAT ที่มีสิทธิ์ Base นี้ |
| AIRTABLE_BASE_ID | `app…` |
| AIRTABLE_USERS_TABLE | `Users` หรือ Table ID |
| AIRTABLE_TASKS_TABLE | `Tasks` หรือ Table ID |
| AIRTABLE_UPDATES_TABLE | `Task Updates` หรือ Table ID |
| AIRTABLE_FOLLOWUPS_TABLE | `Follow-ups` หรือ Table ID |
| AIRTABLE_NOTIFICATIONS_TABLE | `Notifications` หรือ Table ID |
| GOOGLE_CLIENT_ID | OAuth Web Application Client ID |
| GOOGLE_CLIENT_SECRET | Client Secret เก็บที่นี่เท่านั้น |
| WEB_APP_URL | Deployment URL ลงท้าย `/exec` |
| ENABLE_EMAIL_NOTIFICATIONS | `false` ระหว่างติดตั้งและทดสอบ |

ถ้าไม่ตั้งชื่อ Table ระบบใช้ชื่อใน schema เป็นค่าเริ่มต้น Field names ยังต้องตรงกับ schema

เลือก `initializeProject` จากเมนู Run เพื่อเติม Base/Table ID ที่ตรวจแล้วและตั้งการแจ้งเตือนเป็น `false` เฉพาะค่าที่ยังไม่มี ไม่เปลี่ยน credentials หรือ flags เดิม และหยุดก่อนแก้ไขเมื่อพบ Base/Table ID ที่ขัดแย้ง ฟังก์ชันนี้ไม่สร้าง records หรือ triggers และไม่ส่งข้อความ

หลังตั้ง credentials เลือก `checkDeployment` แล้วกด Run จาก editor ของเจ้าของ เพื่อเช็กค่าที่จำเป็น เขตเวลา URL `/exec` และสิทธิ์อ่านทั้ง 5 ตารางด้วย GET ตารางละหนึ่งรายการ รายงานไม่แสดง secret หรือ records และไม่ทดสอบสิทธิ์เขียน Google OAuth หรือการส่งแจ้งเตือน จึงยังต้องทดสอบตามข้อ 6

สองคำสั่งนี้เรียก helper ภายในที่ลงท้าย `_` และตรวจว่า Google active user กับ effective user เป็นบัญชีเดียวกันและมีอีเมลก่อนอ่านหรือตั้งค่า การเรียกจาก browser ของผู้ใช้อื่นหรือผู้ที่ไม่ระบุตัวตนจะถูกปฏิเสธ ไม่ใช้ app role หรือข้อมูลที่ browser ส่งมายืนยันสิทธิ์

## 4. Deploy ครั้งแรกเพื่อรับ callback URL

Deploy → New deployment → Web app

- Execute as: **Me** (บัญชีเจ้าของ)
- Who has access: **Anyone** ตามตัวเลือกที่บัญชีและนโยบายองค์กรอนุญาต

เจ้าของต้องตรวจและอนุญาต scopes ของ Script ในหน้า Google ด้วยตัวเอง เมื่อ Deploy แล้วคัดลอก URL `/exec` ไปตั้ง `WEB_APP_URL` อย่าใช้ URL `/dev` หรือ URL iframe `script.googleusercontent.com`

หน้าเว็บที่ยังไม่ผ่าน Login ไม่คืนข้อมูล Airtable ทุก data RPC ต้องมี session และผ่านการตรวจผู้ใช้ก่อน

## 5. สร้าง Google OAuth Web Application Client

ใช้ [Google Cloud Console](https://console.cloud.google.com/) สร้างหรือเลือกโปรเจกต์ของเจ้าของ ตั้ง OAuth consent screen / Google Auth Platform สำหรับผู้ใช้ภายนอกองค์กร (External) เมื่อใช้ Gmail ต่างโดเมน

ตั้งชื่อแอปและอีเมลติดต่อ ใช้ scopes สำหรับตัวตน `openid`, `email`, `profile` ถ้าแอปอยู่สถานะ Testing ให้เพิ่มอีเมลเลขาฯ และ Agent ทั้งหมดเป็น test users ตามข้อกำหนดของ Google

สร้าง OAuth Client ประเภท **Web application** แล้วตั้ง Authorized redirect URI เป็น `WEB_APP_URL` เดียวกันทั้งตัวอักษร ตัวอย่าง:

```text
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

นำ Client ID และ Client Secret ไปตั้ง Script Properties ไม่ต้องตั้ง JavaScript origin สำหรับ iframe เพราะ flow นี้แลก authorization code บน Backend

ควรใช้โปรเจกต์ Cloud มาตรฐานที่เจ้าของดูแลสำหรับ consent และ credentials และตรวจการเชื่อมโปรเจกต์ Cloud ใน Apps Script ตามนโยบายองค์กร หาก Google บังคับตรวจแอป / โดเมน / URI ให้ทำตามข้อกำหนดใน Console ก่อนเปิดให้ทีมใช้ ไม่ข้ามหน้าคำเตือนความปลอดภัย

## 6. ทดสอบ Login ก่อนเชื่อมงานจริงทั้งทีม

เปิด URL `/exec` โดยตรงใน Chrome / Edge ปกติ → กด “เข้าสู่ระบบด้วยบัญชี Google” → กด “ดำเนินการต่อที่ Google” การกดครั้งที่สองทำให้เปิด Google แบบ top-level จาก user activation ตาม sandbox ของ HTML Service

ระบบทำตามลำดับนี้:

1. สร้าง verifier ในเบราว์เซอร์ เก็บใน sessionStorage และส่งเฉพาะ SHA-256 challenge ไปเซิร์ฟเวอร์
2. เซิร์ฟเวอร์สร้าง state แบบใช้ครั้งเดียว อายุ 10 นาที
3. Google ส่ง authorization code กลับมาที่ `/exec`
4. เซิร์ฟเวอร์แลก code ด้วย Client Secret แล้วเรียก Google UserInfo ด้วย access token ที่ได้โดยตรง
5. จับคู่ `sub` / verified email กับ Users ที่เปิด Active และ role ถูกต้อง
6. ส่ง ticket อายุ 2 นาทีให้หน้าเว็บ; หน้าเว็บต้องแสดง verifier เดิมก่อนสร้าง session

ไม่มีการใช้ `Session.getActiveUser().getEmail()` ระบุตัว Agent และไม่มีการรับ role / email / UID จากเบราว์เซอร์เป็นหลักฐานสิทธิ์ ไม่มีการ decode JWT แล้วเชื่อถือ payload หรือเรียก tokeninfo เพื่อยืนยันตัวตน

ทดสอบอย่างน้อยสองบัญชี Gmail ต่างบัญชี / ต่างโดเมน บนอุปกรณ์จริง เนื่องจาก HTML Service origin, browser storage และ OAuth redirect ต้องยืนยันบน deployment จริง หาก browser ปิด storage ให้เปิดลิงก์โดยตรงในเบราว์เซอร์ที่อนุญาต storage ของแอป ห้ามลดการตรวจ verifier เพื่อแก้ปัญหา

Session มีอายุสูงสุด 6 ชั่วโมง และอาจหมดอายุก่อนเมื่อ Apps Script cache ถูกล้าง ให้ Login ใหม่ได้ตามปกติ Reload หน้า callback URL เดิมอาจพบว่า state ใช้แล้ว ให้เปิด URL `/exec` ที่ไม่มี query เพื่อเริ่มใหม่

Gmail / Workspace ที่ Google เป็นผู้ยืนยันตัวตนผูก Google Subject ครั้งแรกโดยอัตโนมัติ สำหรับ Google account ที่ใช้อีเมล third-party และไม่มี Workspace `hd` ต้องให้ผู้ดูแลใส่ Google Subject ที่ตรวจสอบแล้วล่วงหน้า

## 7. เปิดการแจ้งเตือนเมื่อพร้อม

โค้ดไม่ได้สร้าง Trigger หรือส่งอีเมลในการติดตั้งอัตโนมัติ ให้เปิดหลังตรวจผู้รับและอนุมัติทดสอบแล้วเท่านั้น

เปลี่ยน `ENABLE_EMAIL_NOTIFICATIONS` เป็น `true` → เปิดหน้า Triggers ใน Apps Script → Add Trigger เลือกฟังก์ชัน `dailyMaintenance_` → Time-driven → Day timer → ช่วง 08:00–09:00 → Timezone Bangkok

อีกวิธีคือรัน `installDailyTrigger_` จาก Apps Script Editor ในบัญชีเจ้าของ โปรดตรวจ consent สำหรับส่งเมลเมื่อ Google ขอ

Daily maintenance สร้างสรุปให้เลขาฯ / Admin วันละครั้งและประมวลผลคิวสูงสุด 25 อีเมลต่อครั้ง การแจ้งเปลี่ยนสถานะถูกสร้างเป็นคิวทันที แต่จะส่งเมื่อ dispatcher ทำงาน หากต้องการส่งบ่อยขึ้น เพิ่ม time-driven trigger ของ `sendQueuedNotifications_` เช่น ทุก 15 นาที และตรวจโควตา Google / Airtable ก่อน

เวลาของ time-driven trigger เป็นช่วงเวลาตามกลไก Google ไม่รับประกันส่งตรง 08:00:00

Notifications ที่อยู่ `Sending` / `Failed` ให้เจ้าของตรวจสอบก่อนเปลี่ยนกลับเป็น `Pending` เพราะอาจมีการส่งออกไปแล้ว ห้ามตั้ง retry อัตโนมัติให้สถานะเหล่านี้โดยไม่ตรวจสอบ

## 8. อัปเดตเวอร์ชัน

แก้โค้ด → Deploy → Manage deployments → Edit → New version → Deploy โดยใช้ deployment เดิม เพื่อให้ callback URL ไม่เปลี่ยน จากนั้นทดสอบใหม่กับสองบัญชี ถ้าสร้าง deployment ใหม่ ต้องแก้ทั้ง WEB_APP_URL และ OAuth redirect URI

## ปัญหาที่พบบ่อย

| อาการ | ตรวจสอบ |
|---|---|
| `redirect_uri_mismatch` | URI ใน OAuth Client และ WEB_APP_URL ต้องตรงกันและเป็น `/exec` |
| Login ถูกปฏิเสธ | Test users, consent screen, นโยบาย Google Workspace, ตัวเลือก access ของ Web app |
| ไม่พบ verifier | เปิดในเบราว์เซอร์เดิม / แท็บเดิมและอนุญาต sessionStorage ของแอป |
| บัญชียังไม่ได้รับอนุญาต | Users.Email, Active, Role, ค่า Google Subject และข้อมูลซ้ำ |
| Airtable 401 / 403 | PAT หมดอายุ, scopes หรือ Base access |
| Airtable 404 / 422 | Base ID, Table ID, Field names, Lookup / Select options ตาม schema |
| CONFLICT | มีผู้อื่นแก้งาน ให้เปิดรายละเอียดล่าสุดแล้วส่งใหม่ |
| คำขอยังบันทึกไม่ครบ | ส่งคำขอเดิมซ้ำ; หากปิดหน้าไปแล้วให้เจ้าของตรวจ operation journal / ประวัติใน Airtable |
| เวลาหรือวันไม่ตรง | ตั้ง Apps Script Timezone และฟิลด์วันที่ตาม schema |

กรณี operation ค้าง ให้เจ้าของตรวจ Script Properties ชื่อ `operation:…` เทียบ task / update / notification ใน Airtable ก่อนคืนสถานะหรือเอา journal ออก การลบ journal โดยไม่ตรวจอาจทำให้ขั้นตอนที่ทำสำเร็จแล้วถูกทำซ้ำ ข้อมูลที่แก้โดยตรงจาก Airtable ไม่อยู่ภายใต้ script lock ของแอป

## เอกสารทางการ

- [Google Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [HTML Service restrictions](https://developers.google.com/apps-script/guides/html/restrictions)
- [Google OAuth Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OpenID Connect / UserInfo](https://developers.google.com/identity/openid-connect/openid-connect)
- [Installable time-driven triggers](https://developers.google.com/apps-script/guides/triggers/installable)
