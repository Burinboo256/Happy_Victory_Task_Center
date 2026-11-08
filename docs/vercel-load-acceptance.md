# ผลทดสอบโหลดบนเครื่อง

6 พฤศจิกายน 2026 · เจ้าของระบุ **พร้อมกัน 5 คน / งานสะสม 250 รายการ** ผลนี้เป็นหลักฐาน local HTTP acceptance ยังไม่ใช่ performance acceptance ของ Vercel / Airtable จริง

## ขอบเขตและวิธีรัน

ใช้ production build ของ Next.js, PostgreSQL จริงในฐานข้อมูลทดสอบแยก และ session สมมติ 5 Agents กับ Secretary สำหรับอ่านภาพรวม Airtable upstream จำลองงาน 250 รายการ กระจาย Agent ละ 50 งาน รองรับ pagination ครั้งละ 100 records / field projection และหน่วงคำตอบละ 60 ms ไม่มี Google Login, network latency ของผู้ให้บริการ, cold start ของ Vercel หรือการเขียนข้อมูลธุรกิจในรอบนี้

รันจาก `web/` หลังเปิด disposable PostgreSQL ตาม [README](../web/README.md):

```powershell
npm run build
$env:TEST_DATABASE_URL='postgresql://hvr:hvr-local-test@127.0.0.1:55432/hvr_test'
npm run test:load -- --users=5 --tasks=250 --delay-ms=60
```

ตัว runner สร้าง schema สุ่ม `hvr_load_<uuid>` และ session ในฐานข้อมูลชื่อ test เท่านั้น เปิดเว็บชั่วคราวบน `127.0.0.1:4182` แล้วหยุด process / ลบ schema ที่สร้างเองเมื่อจบ ไม่ใช้พอร์ต 3000, session จริง หรือ PAT จริง preloader จำกัด synthetic Base / credentials และปฏิเสธ external network กับการเขียนทั้งหมด ไม่มี auth bypass endpoint ในแอป

## ผลรอบจำลอง latency 60 ms

รายงาน `artifacts/vercel/load/28e96ffb-720b-4843-b5cb-fef6bc302fc3.json` เก็บตัวเลขและ error codes โดยไม่มี cookie / token / เนื้อหางาน ระหว่างรอบนี้มี regression suites อื่นทำงานบนเครื่องด้วย จำนวน samples น้อย จึงใช้ตรวจพฤติกรรม ไม่ใช้ตั้ง SLA หรืออ้าง sustained throughput

| ขั้นทดสอบ | สำเร็จ / ทั้งหมด | เวลาตอบกลับที่สังเกต |
|---|---|---|
| Secretary โหลดครบ 250 งาน แบบต่อเนื่อง | 3 / 3 | 1,052–1,342 ms |
| Agent โหลด context แบบต่อเนื่อง | 5 / 5 | 179–290 ms |
| 5 Agents โหลดรายการพร้อมกัน คนละคำขอ | 5 / 5 | 1,362–2,301 ms |
| Overload: profile ละ 4 คำขอ รวม 20 พร้อมกัน | 6 / 20 | อีก 14 คำขอได้ 503 `AIRTABLE_BUSY` พร้อม `Retry-After: 2` |
| หลังรอคิวเดิมจบ โหลดภาพรวมอีกครั้ง | 1 / 1 | 1,019 ms |

คำตอบสำเร็จมีจำนวนงานครบตามสิทธิ์ ไม่มีงานข้ามเจ้าของ context ทั้ง 5 คำขอตรวจ Users ใหม่ 5 ครั้งและไม่ list Tasks ทุกคำตอบใช้ `private, no-store` ไม่มี business operation ถูกสร้าง คำขอที่เจอ busy ไม่ได้รับข้อมูลจาก cache สิทธิ์เดิม

## เวลาอ่าน Airtable จริง

เพิ่ม CLI `npm run probe:live -- --confirm-test-base=appoQzvQwGShlq4OJ` รันจาก `web/` ใช้ development config / PostgreSQL local เดิม จำกัด test Base นี้เท่านั้น, GET เฉพาะ Users / Tasks ไม่เกิน 30 คำขอ และหยุดเริ่มคำขอหลัง 90 วินาที ไม่สร้าง session หรือ business mutations, ไม่รันใน CI และไม่ retry อัตโนมัติเมื่อเจอ busy รายงานไม่เก็บชื่อ อีเมล Subject, cookie หรือเนื้อหางาน

รอบ `artifacts/vercel/probes/15f2f271-ae0d-4e82-aa0e-a93a503b1019.json` อ่านสำเร็จ 25 คำขอ / mutation 0 มี task summaries ทั้ง Base 11 งาน และของ Agent ที่เลือก 4 งาน ทุก sample เริ่มด้วย Users GET ใหม่ แล้วเรียก service `bootstrap` จริง ไม่มี Google session หรือ browser HTTP ในการวัดนี้

| Service read รวม Users GET | Samples | เวลา min–max | Upstream calls ต่อ sample |
|---|---|---|---|
| Agent full / 4 งาน | 3 | 657–698 ms | 2 |
| Agent context | 3 | 336–341 ms | 1 |
| Secretary full / 11 งาน | 3 | 996–1,057 ms | 3 |
| Secretary context | 3 | 658–718 ms | 2 |

คำขอ discovery แรกใช้ 3,220 ms และเก็บไว้ในรายงาน ไม่รวมในกลุ่ม service samples ด้านบน ส่วน upstream 24 คำขอถัดไปอยู่ที่ 320–355 ms ยังไม่ทราบสาเหตุของคำขอแรกที่ช้า และไม่ใช้ sample เล็กนี้รับรอง cold-start / SLA

นำ 330 ms มาเป็น input ของ **แบบจำลอง** แล้วรัน `test:load -- --users=5 --tasks=250 --delay-ms=330` โดยไม่เพิ่ม records ใน Airtable จริง ผล `artifacts/vercel/load/0ce6a6cd-7be3-4462-914e-9f8580ef3366.json`: normal burst สำเร็จ 5/5 ที่ 1,531–2,448 ms, Secretary full 3/3 ที่ 1,737–1,934 ms, overload สำเร็จ 7/20 อีก 13 คำขอ busy / Retry-After 2 วินาที และกลับมาอ่านครบได้หลังคิวเดิมจบ ยังเป็น synthetic upstream ที่ latency คงที่ ไม่ใช่โหลดจริง 250 งานบน Airtable

## งบ API ที่ต้องยืนยัน

แยก rate limit ต่อวินาทีออกจาก monthly quota: [Airtable ระบุ](https://support.airtable.com/articles/7735693959-managing-api-call-limits-in-airtable) 5 requests/วินาที/Base; Free มี 1,000 และ Team มี 100,000 calls/เดือน/workspace ต้องนับ integration อื่นและทุก Base ใน workspace เดียวกันด้วย เจ้าของเลือกคง Free สำหรับ staging; ไม่ซื้อแผนหรือเปลี่ยน subscription

ตรวจ Workspace settings → Usage วันที่ 8 พฤศจิกายน 2026 แล้ว: workspace ที่มี test Base `appoQzvQwGShlq4OJ` แสดง **Team Trial** ไม่ใช่ Free ในขณะตรวจ หน้าจอระบุ trial สิ้นสุด `6/30/2028` และเปลี่ยนเป็น Free อัตโนมัติ วันที่นี้เป็นค่าที่ UI แสดง ไม่ใช่การรับรองสิทธิ์ trial ในอนาคต

| ยอดเดือนนี้ ณ เวลาตรวจ | Public API calls |
|---|---:|
| รวม workspace / เพดานที่ UI แสดง | 903 / 100,000 |
| Base ทดสอบ Local Test | 872 |
| Base ระบบเดิมใน workspace เดียวกัน | 31 |

งบระยะยาวยังยึด Free ตามที่เจ้าของเลือก: เทียบยอด 903 กับเพดาน 1,000 จะเหลือ **97 calls** ไม่ใช่ยอดคงเหลือจริงของ Team Trial ใช้เป็นงบวางแผนแบบเผื่อไว้เท่านั้น ยอด Usage อาจอัปเดตล่าช้าและการใช้งานอื่นยังเพิ่มได้ หลักฐาน snapshot อยู่ที่ `artifacts/vercel/airtable-usage.json`

ก่อน live test รอบถัดไป อ่าน Usage ใหม่และประมาณ calls รวม login/reads/mutations/retries โดยกันสำรองอย่างน้อย 50 calls สำหรับการตรวจและการใช้งานอื่น ด้วย snapshot นี้จึงเหลืองบทดสอบไม่เกิน 47 calls ตามแผน ไม่ใช่ตัวจำกัดที่ระบบบังคับอัตโนมัติ คงการพัก bulk/live load 250 งาน ใช้ synthetic load สำหรับงานหนัก และทดสอบมือถือเฉพาะกรณีที่ยังขาด หยุดรอบทดสอบหากประมาณการเกินงบหรือพบ 429; ไม่รัว retry เพื่อใช้ grace period และไม่ลดการตรวจ Active/Role

ตัวอย่างงบขั้นต่ำ: 5 คน × 5 full-list visits/วัน × 22 วัน × 2 calls = 1,100 calls/เดือน ก่อน detail/mutations/OAuth และ integrations อื่น ตัวเลขนี้เป็น scenario ไม่ใช่ยอดใช้งานจริงของทีม และ Secretary/full 250 งานอาจใช้มากกว่า 2 calls ตาม projection ด้านล่าง ต้องตกลง usage budget และแนวทาง production กับเจ้าของ ไม่ซื้อแผนหรือย้ายข้อมูลธุรกิจออกจาก Airtable อัตโนมัติ

สำหรับแบบจำลอง 250 งานกระจาย 5 Agents และ Users ไม่เกิน 100 records: Agent full = 2 calls, context = 1; Secretary full = 5, context = 2 รวม Users GET ที่ตรวจสิทธิ์แล้ว คำนวณ baseline ด้วย `2 × Agent full visits + Agent context visits + 5 × Secretary full visits + 2 × Secretary context visits` ต่อเดือน แล้วเพิ่ม detail, mutations, polling, OAuth, diagnostics และ integrations อื่นตามการใช้งานจริง ไม่ลดการตรวจ Active / Role เพื่อประหยัด quota

## ข้อผิดพลาดที่พบและแก้

เดิมตัวจอง rate slot เลื่อน `next_at` ก่อนตรวจว่าคิวเต็ม คำขอที่ถูกปฏิเสธจึงเพิ่มเวลาคิวด้วย Regression บน PostgreSQL จริงส่ง 40 คำขอขณะ cooldown และยืนยันว่าคิวถูกเลื่อนไปไกลขึ้นก่อนแก้

แก้เป็นตรวจความจุใน atomic `ON CONFLICT ... DO UPDATE ... WHERE` คำขอที่รอเกิน 1.5 วินาทีไม่ได้จอง slot และอ่านเวลารอปัจจุบันเพื่อตอบ `Retry-After` Regression ยืนยันว่า rejected requests ไม่เปลี่ยน `next_at` / cooldown และรับคำขอได้เมื่อ cooldown เดิมสิ้นสุด ส่วนการเว้นระยะข้าม client instances ยังผ่าน

## หลักฐานก่อน release ที่ยังขาด

เพิ่ม HTTP regression `web/tests/api/contention.spec.ts` วันที่ 8 พฤศจิกายน 2026: ใช้ production build บน localhost, PostgreSQL ทดสอบจริง และ HTTP clients แยกสองตัวที่ใช้ Secretary session เดียวกัน หยุด upstream จำลองหลัง journal บันทึก step เริ่มเขียนเพื่อยืนยันว่าคำขอแรกยัง `running` ขณะส่งคำขอที่สองบนงานเดียวกัน ได้ `409 RESOURCE_BUSY`; ส่ง key เดิมระหว่างนั้นได้ `202 running` หลังปล่อยคำขอแรกสำเร็จ การลองคำขอที่สองด้วย version เก่าได้ `409 VERSION_CONFLICT` แล้วส่ง key ใหม่กับ version ใหม่จึงสำเร็จ ตรวจประวัติอย่างละหนึ่งต่อการแก้จริง, Completed At/version ไม่เปลี่ยนเมื่อ replay คำขอแรก และไม่มี reservation ค้าง กรณีนี้รวมใน API suite 14 tests; ไม่ใช่ Google Login, Vercel หลาย instances หรือ Airtable จริง และไม่ปิด cloud contention/recovery gate

เพิ่ม regression ของ queued mutation ที่จอง slot ก่อนคำขออื่นได้รับ 429 แล้ว: ต้องตรวจ shared cooldown อีกครั้งหลังรอ slot และหยุดก่อนเรียก transport ผลก่อนแก้ส่งออกไป 2 calls; หลังแก้ส่งเพียง call แรก และ mutation ได้ AIRTABLE_BUSY / Retry-After โดยไม่กลายเป็น uncertain write ชุด PostgreSQL ปัจจุบันผ่าน 8 tests; CI ตรวจซ้ำครบแล้วตาม [deployment แรก](vercel-first-deployment.md)

- วัด Airtable จริงกับข้อมูลและขนาดทีมใกล้งานจริง รวม API usage budget ของบัญชีที่ใช้
- วัด staging ใน region / PostgreSQL provider ที่เลือก รวม cold start, sustained load และ network failure
- เก็บ latency แยก successful / busy, throughput และ error rate ด้วย samples มากพอ แล้วตกลงเกณฑ์รับรองกับเจ้าของ
- ทดสอบ Safari / Chrome / LINE Rich Menu และ screen reader บนอุปกรณ์จริง ตาม [คู่มือมือถือ](vercel-device-acceptance.md)

ผลนี้ไม่เปิด writes / notifications เพิ่ม และไม่อนุมัติ staging หรือ cutover
