# ทดสอบ iPhone / Android ก่อนเปิดใช้

สถานะ 6 พฤศจิกายน 2026: เจ้าของมีทั้ง iPhone และ Android; **ยังไม่มีผลทดสอบอุปกรณ์จริง** Chrome mobile viewport / axe บนเครื่องเป็นหลักฐานแยก ไม่ใช้ทำเครื่องหมายผ่านในหน้านี้

มี [หน้าเว็บ Vercel ออนไลน์](https://happy-victory-task-center.vercel.app/login) แล้ว แต่ยังแสดงเตรียมระบบเพราะ cloud DB / OAuth ไม่ตั้งค่า จึงยังเริ่มกรณี Login / ส่งงานด้านล่างไม่ได้ ดู [สถานะ deployment](vercel-first-deployment.md)

## เตรียมรอบทดสอบ

- ต้องมี HTTPS origin ของ staging ที่ทั้งสองโทรศัพท์เข้าถึงได้ พร้อม OAuth callback ตรง origin และเชื่อม test Base เท่านั้น `localhost:3000` ปัจจุบันเข้าถึงได้เฉพาะคอมพิวเตอร์ ไม่ใช้แทน URL บนโทรศัพท์
- ยังไม่เปิดพอร์ต public / tunnel หรือเปลี่ยน OAuth origin เพื่อข้ามขั้นเตรียม staging รอเจ้าของเลือกขั้นถัดไปตาม [แผน Deploy](vercel-deployment-plan.md)
- ระบุ release SHA / build, origin, OS / browser / LINE version, วันที่เวลา Bangkok และบัญชีตามบทบาทโดยใช้ชื่อ TEST-AGENT-A/B / TEST-SECRETARY ในรายงาน
- เปิด writes เฉพาะ test Base; jobs / email / LINE delivery ปิดไว้ ตั้งชื่องานสมมติ `[DEVICE TEST] <iOS|Android> <รอบ>` ไม่ใส่ข้อมูลลูกค้าจริง
- เจ้าของเลือกบัญชี / ยืนยัน Google ด้วยตนเอง เก็บภาพผลหลัง callback โดยไม่ถ่าย authorization code / state / cookie / credentials

## เส้นทางที่ต้องผ่านทั้งสองเครื่อง

เปิด Safari บน iPhone และ Chrome บน Android จากนั้นทดสอบลิงก์เดียวกันจาก LINE ด้วย URL staging `/tasks/new?openExternalBrowser=1` อย่าแก้ Rich Menu production ระหว่างซ้อม

| กรณี | วิธีทดสอบ | ผลที่ต้องได้ |
|---|---|---|
| เข้าใหม่จาก LINE | Logout แล้วเปิดลิงก์ส่งงาน ยืนยัน Google ด้วยบัญชี Agent | เปิด browser ภายนอกและกลับ `/tasks/new`; ไม่มีหน้าวน Login |
| มี session แล้ว | เปิดลิงก์เดิมซ้ำ | ถึงฟอร์มโดยตรง เจ้าของงานมาจาก Agent ที่ Login |
| ฟอร์ม / keyboard | กรอกไทย เลือกวัน / ประเภท เปิด keyboard และเลื่อนถึงปุ่มส่ง; หมุนจอ | เห็น label, ค่า, validation และปุ่มส่งครบ ไม่มีปุ่มถูก keyboard บังจนใช้งานไม่ได้ |
| ส่งงาน / แตะซ้ำ | ส่งงานสมมติและแตะซ้ำเร็ว ตรวจผลจาก Secretary | task / audit อย่างละ 1, วันที่ไทยถูกต้อง และแจ้งสำเร็จหลังบันทึกครบ |
| ข้อมูลตามบทบาท | Agent A/B เปิดงานตนเองและ URL ของอีกเจ้าของ; Secretary เปิด detail | Agent ไม่เห็นงานข้ามเจ้าของ / ข้อความภายใน / นัดภายใน; Secretary เห็น controls และข้อมูลที่มีสิทธิ์ |
| นัด / timeline | Secretary เพิ่มนัดและข้อความภายใน แล้ว reload บน Agent | ไม่มีข้อมูลภายในหลุด; วันที่มีปีและเวลา Bangkok อ่านได้ |
| หลุดเครือข่าย | ตัดการเชื่อมต่อชั่วคราวระหว่างโหลด / ส่ง แล้วเชื่อมใหม่ | แสดง error / pending / review ตามจริง ไม่แสดงสำเร็จลวง; คำขอไม่แน่นอนใช้ key เดิมและ runbook |
| Logout | ออกจากบัญชีเครื่องหนึ่ง แล้ว reload หน้า protected; อีกบัญชียังใช้อีกเครื่อง | เครื่องที่ Logout ไม่เห็นข้อมูลเดิม อีก session ไม่ถูกเพิกถอน |

## ตรวจการเข้าถึงด้วยคน

- iPhone ใช้ VoiceOver; Android ใช้ TalkBack: สำรวจ Login, navigation, form, validation, loading/error และ detail/timeline ได้ตามลำดับ ไม่มีส่วนรับ focus ที่ซ่อนอยู่
- ปุ่มและช่องกรอกมีชื่อชัดเจน เปิดเมนูแล้ว focus อยู่ในเมนู ปิดแล้วกลับปุ่มเดิม; error ถูกประกาศและระบุช่องที่ต้องแก้
- ทดสอบขนาดข้อความใหญ่ / zoom, แนวตั้ง / แนวนอน และตาราง reports เลื่อนภายในได้โดยปุ่มสำคัญไม่หาย
- บันทึกคำที่ screen reader อ่านผิด / ไม่ประกาศตามที่ได้ยินจริง ห้ามสรุปผ่านจากผล axe อย่างเดียว

## แบบบันทึกผล

| อุปกรณ์ / เส้นทาง | ผู้ทดสอบ / release / origin | ผลกรณีข้างต้น / evidence / ปัญหา |
|---|---|---|
| iPhone Safari โดยตรง | รอระบุ | ยังไม่ทดสอบ |
| iPhone LINE → Safari | รอระบุ | ยังไม่ทดสอบ |
| Android Chrome โดยตรง | รอระบุ | ยังไม่ทดสอบ |
| Android LINE → browser ภายนอก | รอระบุ | ยังไม่ทดสอบ |
| VoiceOver / TalkBack | รอระบุ | ยังไม่ทดสอบ |

เก็บหลักฐานใน ignored `artifacts/vercel/devices/<รอบ>/` ระบุ expected / actual / เวลา / operation ID เมื่อมีปัญหา การเปลี่ยน origin, build หรือแก้ flow ที่ล้มเหลวต้องซ้อมส่วนที่เกี่ยวข้องใหม่ M4 / release acceptance ยังไม่ผ่านจนมีผลจริงและเจ้าของรับรอง
