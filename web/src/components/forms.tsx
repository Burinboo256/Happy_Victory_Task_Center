'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  documentCategories,
  type DocumentEntry,
  type DocumentInput,
  type DocumentList,
  type DocumentVersion,
} from '@/domain/documents';
import type { Bootstrap } from '@/domain/model';
import styles from './forms.module.css';

type Details = { document: DocumentEntry; versions: DocumentVersion[] };
type EditorState = {
  id: string;
  creating: boolean;
  revision: number;
  versionId: string | null;
  data?: DocumentInput;
};
function FormDialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="document-dialog-title"
      onCancel={close}
    >
      <div className={styles.dialogHeading}>
        <h2 id="document-dialog-title">{title}</h2>
        <button type="button" className={styles.secondary} onClick={close}>
          ปิด
        </button>
      </div>
      {children}
    </dialog>
  );
}
function DocumentEditor({
  value,
  busy,
  save,
}: {
  value: EditorState;
  busy: boolean;
  save: (data: DocumentInput) => Promise<void>;
}) {
  const [source, setSource] = useState(
    value.data?.url.includes('drive.google.com') ? 'drive' : 'allianz',
  );
  const initial = value.data;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !event.currentTarget.reportValidity()) return;
    const f = new FormData(event.currentTarget);
    await save({
      title: String(f.get('title')).trim(),
      category: String(f.get('category')) as DocumentInput['category'],
      description: String(f.get('description')).trim(),
      keywords: String(f.get('keywords'))
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      audience: String(f.get('audience')) as DocumentInput['audience'],
      url: String(f.get('url')).trim(),
      label: String(f.get('label')).trim(),
      effectiveDate: String(f.get('effectiveDate')),
      note: String(f.get('note')).trim(),
    });
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.hint}>บันทึกเป็นร่างก่อน Admin ตรวจและเผยแพร่ ระบบเก็บเฉพาะข้อมูลกับลิงก์</p>
      <label>
        <span className={styles.fieldLabel}>
          ชื่อเอกสาร <b>*</b>
        </span>
        <input name="title" defaultValue={initial?.title} required maxLength={250} />
      </label>
      <div className={styles.twoColumns}>
        <label>
          หมวดเอกสาร
          <select name="category" defaultValue={initial?.category}>
            {documentCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          ผู้ที่เห็นเมื่อเผยแพร่
          <select name="audience" defaultValue={initial?.audience || 'all'}>
            <option value="all">ทุกบัญชีที่ Active</option>
            <option value="staff">Admin และเลขา</option>
          </select>
        </label>
      </div>
      <label>
        คำอธิบายการใช้งาน
        <textarea
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={initial?.description}
        />
      </label>
      <label>
        คำค้น / ชื่อเรียกอื่น
        <input
          name="keywords"
          defaultValue={initial?.keywords.join(', ')}
          placeholder="เช่น ใบหักบัญชี, DDA, ชำระเบี้ย"
        />
        <small>คั่นด้วยจุลภาค ใช้ค้นได้ทั้งบนเว็บและ LINE AI</small>
      </label>
      <label>
        แหล่งเอกสาร
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="allianz">Allianz</option>
          <option value="drive">Google Drive</option>
        </select>
      </label>
      <label>
        <span className={styles.fieldLabel}>
          ลิงก์เอกสาร <b>*</b>
        </span>
        <input
          name="url"
          type="url"
          required
          maxLength={2048}
          defaultValue={initial?.url}
          placeholder={
            source === 'drive'
              ? 'https://drive.google.com/file/d/…/view'
              : 'https://www.allianz.co.th/content/dam/…pdf'
          }
        />
      </label>
      <p className={styles.hint}>
        {source === 'drive'
          ? 'ใช้ลิงก์แชร์รายไฟล์ ตั้งสิทธิ์ใน Drive ให้ผู้รับเปิดได้ ระบบไม่เพิ่มสิทธิ์ Drive ให้อัตโนมัติ'
          : 'ใช้ลิงก์ PDF ต้นทางของ Allianz หรือ Azay'}
      </p>
      <div className={styles.twoColumns}>
        <label>
          <span className={styles.fieldLabel}>
            ชื่อฉบับในระบบ <b>*</b>
          </span>
          <input name="label" defaultValue={initial?.label} required maxLength={120} />
        </label>
        <label>
          วันที่เริ่มใช้ตามเอกสาร
          <input name="effectiveDate" type="date" defaultValue={initial?.effectiveDate} />
        </label>
      </div>
      <label>
        <span className={styles.fieldLabel}>
          สิ่งที่เปลี่ยน / เหตุผลที่เพิ่ม <b>*</b>
        </span>
        <textarea name="note" rows={2} defaultValue={initial?.note} required maxLength={1000} />
      </label>
      <button type="submit" className={styles.primary} disabled={busy}>
        {busy ? 'กำลังบันทึก…' : 'บันทึกเป็นร่าง'}
      </button>
    </form>
  );
}
export function FormsLibrary({
  data,
  request,
  initialId,
  initialQuery = '',
}: {
  data: Bootstrap;
  request: (url: string, options?: RequestInit) => Promise<unknown>;
  initialId?: string;
  initialQuery?: string;
}) {
  const [list, setList] = useState<DocumentList | null>(null);
  const [q, setQ] = useState(initialQuery),
    [category, setCategory] = useState('');
  const [tab, setTab] = useState<'published' | 'favorites' | 'drafts' | 'paused'>('published');
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [details, setDetails] = useState<Details | null>(null),
    [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const library = useRef<HTMLElement>(null);
  const admin = data.user.role === 'Admin',
    manager = data.user.role !== 'Agent';
  const refreshList = () => setRefresh((value) => value + 1);
  const openDetails = useCallback(
    async (id: string) => {
      try {
        setError('');
        const value = (await request('/api/forms/' + id)) as Details;
        setDetails(value);
        setReviewed([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'เปิดรายละเอียดไม่สำเร็จ');
      }
    },
    [request],
  );
  useEffect(() => {
    if (initialId && data.formsEnabled) void openDetails(initialId);
  }, [initialId, data.formsEnabled, openDetails]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly invalidates results after a successful write.
  useEffect(() => {
    if (!data.formsEnabled) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q, category, tab, page: String(page) });
      void request('/api/forms?' + params, { signal: controller.signal })
        .then((value) => {
          if (!controller.signal.aborted) {
            setList(value as DocumentList);
            setError('');
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setList(null);
            setError(e instanceof Error ? e.message : 'โหลดเอกสารไม่สำเร็จ');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, category, tab, page, refresh, request, data.formsEnabled]);
  async function mutate(url: string, body: unknown) {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken },
      body: JSON.stringify(body),
    });
  }
  async function save(value: DocumentInput) {
    if (!editor || busy) return;
    setBusy(true);
    setError('');
    try {
      if (editor.creating) await mutate('/api/forms', { id: editor.id, data: value });
      else
        await mutate('/api/forms/' + editor.id, {
          action: 'draft',
          revision: editor.revision,
          versionId: editor.versionId,
          data: value,
        });
      setEditor(null);
      setDetails(null);
      setTab('drafts');
      setPage(1);
      setQ('');
      setCategory('');
      refreshList();
      setMessage('บันทึกร่างแล้ว ยังไม่เผยแพร่ให้ผู้ใช้หรือ LINE AI');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function change(id: string, body: unknown, success: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate('/api/forms/' + id, body);
      setMessage(success);
      refreshList();
      if (details) await openDetails(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  function changeTab(value: typeof tab) {
    setTab(value);
    setPage(1);
    setQ('');
    setCategory('');
  }
  function close() {
    if (!busy) {
      setEditor(null);
      setDetails(null);
      setError('');
    }
  }
  if (!data.formsEnabled)
    return (
      <div className="empty">
        <strong>คลังเอกสารยังไม่เปิดใช้งาน</strong>
      </div>
    );
  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <p className={styles.hint}>เปิดเอกสารจาก Allianz หรือ Google Drive · ดาวใช้บ่อยเป็นของบัญชีคุณ</p>
        {manager && (
          <button
            type="button"
            className={styles.primary}
            disabled={!data.writesEnabled || busy}
            onClick={() => {
              setError('');
              setEditor({ id: crypto.randomUUID(), creating: true, revision: 0, versionId: null });
            }}
          >
            + เพิ่มเอกสาร
          </button>
        )}
      </div>
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {error && !editor && !details && (
        <p role="alert" className={styles.error}>
          {error}{' '}
          <button type="button" className={styles.secondary} onClick={refreshList}>
            ลองใหม่
          </button>
        </p>
      )}
      <section
        className={styles.library}
        ref={library}
        aria-label="รายการเอกสาร"
        aria-busy={loading}
      >
        <div className={styles.tabs}>
          <button
            type="button"
            aria-pressed={tab === 'published'}
            onClick={() => changeTab('published')}
          >
            พร้อมเปิด <span>{list?.counts.published ?? '—'}</span>
          </button>
          <button
            type="button"
            aria-pressed={tab === 'favorites'}
            onClick={() => changeTab('favorites')}
          >
            ★ ใช้บ่อย <span>{list?.counts.favorites ?? '—'}</span>
          </button>
          {manager && (
            <button
              type="button"
              aria-pressed={tab === 'drafts'}
              onClick={() => changeTab('drafts')}
            >
              ร่างรอตรวจ <span>{list?.counts.drafts ?? '—'}</span>
            </button>
          )}
          {admin && (
            <button
              type="button"
              aria-pressed={tab === 'paused'}
              onClick={() => changeTab('paused')}
            >
              พักใช้ <span>{list?.counts.paused ?? '—'}</span>
            </button>
          )}
        </div>
        <div className={styles.filters}>
          <label>
            ค้นหาเอกสาร
            <input
              type="search"
              value={q}
              maxLength={300}
              placeholder="ชื่อเอกสาร, HC1, ใบหักบัญชี"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            หมวดเอกสาร
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">ทั้งหมด</option>
              {documentCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.resultCount} role="status">
          {loading ? 'กำลังค้นหา…' : `พบ ${list?.total || 0} รายการ · หน้าละ 10 รายการ`}
        </p>
        <div className={styles.grid}>
          {!loading &&
            list?.items.map((doc) => (
              <article
                className={styles.card}
                key={doc.version.id}
                aria-label={doc.version.data.title}
              >
                {doc.version.status === 'published' && doc.status === 'active' ? (
                  <button
                    type="button"
                    className={styles.favoriteButton}
                    aria-pressed={doc.favorite}
                    aria-label={`${doc.favorite ? 'นำออกจาก' : 'เพิ่มใน'}รายการโปรด: ${doc.version.data.title}`}
                    disabled={busy || !data.writesEnabled}
                    onClick={() =>
                      void change(
                        doc.id,
                        { action: 'favorite', favorite: !doc.favorite },
                        doc.favorite ? 'นำออกจากใช้บ่อยแล้ว' : 'เพิ่มในใช้บ่อยแล้ว',
                      )
                    }
                  >
                    <span aria-hidden="true">{doc.favorite ? '★' : '☆'}</span>
                  </button>
                ) : (
                  <span className={styles.pdfIcon}>ลิงก์</span>
                )}
                <div className={styles.documentInfo}>
                  <h2>{doc.version.data.title}</h2>
                  <div className={styles.documentMeta}>
                    <span className={styles.category}>{doc.version.data.category}</span>
                    <span>{doc.version.source === 'drive' ? 'Google Drive' : 'Allianz'}</span>
                    {doc.version.data.audience === 'staff' && <span>เฉพาะทีม</span>}
                  </div>
                </div>
                <div className={styles.cardActions}>
                  {doc.currentId === doc.version.id && doc.status === 'active' && (
                    <a
                      className={styles.primary}
                      href={`/forms/${doc.id}/open`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      เปิดเอกสาร ↗
                    </a>
                  )}
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => void openDetails(doc.id)}
                  >
                    รายละเอียด
                  </button>
                </div>
              </article>
            ))}
        </div>
        {!loading && list?.total === 0 && (
          <div className={styles.empty}>
            <strong>{tab === 'favorites' ? 'ยังไม่มีเอกสารใช้บ่อยที่ตรงกับการค้นหา' : 'ไม่พบเอกสาร'}</strong>
            <p>
              {tab === 'favorites'
                ? 'กดดาวข้างเอกสารที่ใช้ประจำในแท็บพร้อมเปิด'
                : 'ลองคำค้นอื่น หรือเลือกหมวดทั้งหมด'}
            </p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setQ('');
                setCategory('');
                setPage(1);
              }}
            >
              ล้างตัวกรอง
            </button>
          </div>
        )}
        {!!list && list.pages > 1 && (
          <nav className={styles.pagination} aria-label="หน้าเอกสาร">
            <button
              type="button"
              className={styles.secondary}
              disabled={loading || list.page === 1}
              onClick={() => {
                setPage(list.page - 1);
                library.current?.scrollIntoView();
              }}
            >
              ก่อนหน้า
            </button>
            <span>
              หน้า {list.page} / {list.pages}
            </span>
            <button
              type="button"
              className={styles.secondary}
              disabled={loading || list.page === list.pages}
              onClick={() => {
                setPage(list.page + 1);
                library.current?.scrollIntoView();
              }}
            >
              ถัดไป
            </button>
          </nav>
        )}
      </section>
      <p className={styles.footer}>ข้อมูลฉบับที่เผยแพร่ในระบบ · สิทธิ์เปิดไฟล์ขึ้นกับต้นทาง · ระบบไม่เก็บสำเนาไฟล์</p>
      {(editor || details) && (
        <FormDialog title={editor ? 'เพิ่ม / แก้ไขร่างเอกสาร' : 'รายละเอียดเอกสาร'} close={close}>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {editor ? (
            <DocumentEditor
              key={editor.id + (editor.versionId || 'new')}
              value={editor}
              busy={busy || !data.writesEnabled}
              save={save}
            />
          ) : (
            details && (
              <div className={styles.detail}>
                <h3>{details.document.version.data.title}</h3>
                {details.document.status === 'paused' && (
                  <p role="status" className={styles.error}>
                    เอกสารนี้พักใช้แล้ว
                  </p>
                )}
                {details.versions.map((v) => (
                  <section className={styles.historyItem} key={v.id}>
                    <div>
                      <strong>{v.data.label}</strong>
                      <span
                        className={v.status === 'draft' ? styles.draftBadge : styles.historyBadge}
                      >
                        {v.status === 'draft'
                          ? 'ร่าง'
                          : v.status === 'archived'
                            ? 'ประวัติเดิม'
                            : 'ฉบับที่เผยแพร่'}
                      </span>
                    </div>
                    <p>{v.data.title}</p>
                    <p>{v.data.description}</p>
                    <p className={styles.hint}>
                      หมวด: {v.data.category} · ผู้เห็น:{' '}
                      {v.data.audience === 'staff' ? 'Admin และเลขา' : 'ทุกบัญชีที่ Active'}
                    </p>
                    <p className={styles.hint}>คำค้น: {v.data.keywords.join(', ') || '—'}</p>
                    <p className={styles.hint}>
                      วันที่เริ่มใช้: {v.data.effectiveDate || 'ยังไม่ระบุ'} · ตรวจเมื่อ:{' '}
                      {v.reviewedAt
                        ? new Date(v.reviewedAt).toLocaleDateString('th-TH', {
                            timeZone: 'Asia/Bangkok',
                          })
                        : 'ยังไม่เผยแพร่'}
                    </p>
                    <p>{v.data.note}</p>
                    <a
                      className={styles.primary}
                      href={
                        v.status === 'published' ? `/forms/${details.document.id}/open` : v.data.url
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {v.status === 'draft'
                        ? 'เปิดตรวจลิงก์'
                        : v.status === 'archived'
                          ? 'เปิดลิงก์ในประวัติ'
                          : 'เปิดเอกสาร'}{' '}
                      ↗
                    </a>
                    {v.status === 'draft' && (
                      <div>
                        <button
                          type="button"
                          className={styles.textButton}
                          disabled={busy || !data.writesEnabled}
                          onClick={() =>
                            setEditor({
                              id: details.document.id,
                              creating: false,
                              revision: details.document.revision,
                              versionId: v.id,
                              data: v.data,
                            })
                          }
                        >
                          แก้ไขร่าง
                        </button>
                        {admin && (
                          <>
                            <label className={styles.check}>
                              <input
                                type="checkbox"
                                checked={reviewed.includes(v.id)}
                                onChange={(e) =>
                                  setReviewed((old) =>
                                    e.target.checked
                                      ? [...old, v.id]
                                      : old.filter((id) => id !== v.id),
                                  )
                                }
                              />
                              ตรวจลิงก์ ผู้เห็น ข้อมูล และสิทธิ์เปิดเอกสารแล้ว
                            </label>
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={busy || !data.writesEnabled || !reviewed.includes(v.id)}
                              onClick={() =>
                                void change(
                                  details.document.id,
                                  {
                                    action: 'publish',
                                    revision: details.document.revision,
                                    versionId: v.id,
                                    reviewed: true,
                                  },
                                  'เผยแพร่ฉบับนี้แล้ว',
                                )
                              }
                            >
                              เผยแพร่ฉบับนี้
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                ))}
                <p className={styles.hint}>
                  ประวัติเก็บเฉพาะลิงก์ หากต้นทางเปลี่ยนไฟล์ที่ URL เดิม เนื้อหาที่เปิดอาจเปลี่ยนตาม
                </p>
                {admin && (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy || !data.writesEnabled}
                      onClick={() =>
                        setEditor({
                          id: details.document.id,
                          creating: false,
                          revision: details.document.revision,
                          versionId: null,
                          data: { ...details.document.version.data, label: '', note: '' },
                        })
                      }
                    >
                      + เพิ่มฉบับใหม่
                    </button>
                    {details.document.currentId && (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy || !data.writesEnabled}
                        onClick={() =>
                          void change(
                            details.document.id,
                            {
                              action: 'pause',
                              revision: details.document.revision,
                              paused: details.document.status !== 'paused',
                            },
                            'เปลี่ยนสถานะเอกสารแล้ว',
                          )
                        }
                      >
                        {details.document.status === 'paused' ? 'เปิดใช้งานอีกครั้ง' : 'พักใช้เอกสาร'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </FormDialog>
      )}
    </div>
  );
}
