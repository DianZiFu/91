import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const layout = readFileSync(
  new URL("../src/admin/AdminLayout.tsx", import.meta.url),
  "utf8"
);
const page = readFileSync(
  new URL("../src/admin/BackupPage.tsx", import.meta.url),
  "utf8"
);
const fileIcon = readFileSync(
  new URL("../src/components/icons/FileIcon.tsx", import.meta.url),
  "utf8"
);
const sha256 = readFileSync(
  new URL("../src/lib/sha256.ts", import.meta.url),
  "utf8"
);
const api = readFileSync(new URL("../src/admin/api.ts", import.meta.url), "utf8");
const backupApiHandler = readFileSync(
  new URL("../backend/internal/api/admin_backups.go", import.meta.url),
  "utf8"
);
const backupTransferRoutes = readFileSync(
  new URL("../backend/internal/api/admin.go", import.meta.url),
  "utf8"
);
const backupTransferApi = readFileSync(
  new URL("../backend/internal/api/backup_transfers.go", import.meta.url),
  "utf8"
);
const backupTransferSender = readFileSync(
  new URL("../backend/internal/backuptransfer/outgoing.go", import.meta.url),
  "utf8"
);
const backupTransferTypes = readFileSync(
  new URL("../backend/internal/backuptransfer/types.go", import.meta.url),
  "utf8"
);
const viteConfig = readFileSync(
  new URL("../vite.config.ts", import.meta.url),
  "utf8"
);
const backupTypes = readFileSync(
  new URL("../backend/internal/backup/types.go", import.meta.url),
  "utf8"
);
const backupArchive = readFileSync(
  new URL("../backend/internal/backup/archive.go", import.meta.url),
  "utf8"
);
const backupRestorePrepare = readFileSync(
  new URL("../backend/internal/backup/restore_prepare.go", import.meta.url),
  "utf8"
);
const backupRestoreMerge = readFileSync(
  new URL("../backend/internal/backup/restore_merge.go", import.meta.url),
  "utf8"
);
const backupRestoreAssets = readFileSync(
  new URL("../backend/internal/backup/restore_assets.go", import.meta.url),
  "utf8"
);
const backupRestoreLocal = readFileSync(
  new URL("../backend/internal/backup/restore_local.go", import.meta.url),
  "utf8"
);
const authContext = readFileSync(
  new URL("../src/admin/AuthContext.tsx", import.meta.url),
  "utf8"
);
const css = readFileSync(
  new URL("../src/styles/admin.css", import.meta.url),
  "utf8"
);
const serverMain = readFileSync(
  new URL("../backend/cmd/server/main.go", import.meta.url),
  "utf8"
);
const install = readFileSync(new URL("../install.sh", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../deploy.sh", import.meta.url), "utf8");
const compose = readFileSync(
  new URL("../docker-compose.yml", import.meta.url),
  "utf8"
);

test("backup restore is reachable from the system navigation", () => {
  assert.match(app, /path="backup"[\s\S]*?<BackupPage \/>/);
  assert.match(layout, /to="\/admin\/backup"[\s\S]*?备份恢复/);
  assert.doesNotMatch(app, /path="\/tmp"/);
});

test("backup page keeps destructive restore confirmation concise", () => {
  assert.match(page, /restoreText !== "确认恢复"/);
  assert.doesNotMatch(page, /restorePassword|PasswordInput|当前管理员密码/);
  assert.match(api, /input: \{ confirmation: string \}/);
  assert.doesNotMatch(backupApiHandler, /CheckCurrentPassword|request\.Password/);
  assert.match(backupApiHandler, /request\.Confirmation != "确认恢复"/);
  assert.match(page, /服务就绪后返回登录页/);
  assert.match(page, /请手动重启后端，页面会继续检测/);
  assert.match(page, /<span>恢复所选内容并重启<\/span>/);
  assert.doesNotMatch(page, /将恢复所选内容并重启/);
});

test("restore acknowledgement stays bounded and survives the planned restart gap", () => {
  assert.match(backupApiHandler, /writeRestoreAccepted/);
  assert.match(backupApiHandler, /compactRestoreReport/);
  assert.match(backupApiHandler, /http\.Flusher/);
  assert.match(backupApiHandler, /restoreRestartGracePeriod/);
  assert.match(api, /export class APIResponseError/);
  assert.match(page, /shouldConfirmRestoreAfterTransportError/);
  assert.match(page, /restoreConfirmationStartedAt/);
  assert.match(page, /backupState\.pendingRestore \|\| Boolean\(backupState\.restoreProgress\)/);
  assert.match(page, /RESTORE_CONFIRMATION_GRACE_MS/);
});

test("restore confirmation input uses the shared theme-aware field palette", () => {
  assert.match(page, /className="admin-input"/);
  assert.match(css, /\.admin-form__row textarea,\s*\.admin-input \{[\s\S]*?background: var\(--bg-sunken\)/);
  assert.match(css, /\.admin-input:focus \{[\s\S]*?border-color: var\(--border-accent\)/);
  assert.match(css, /box-shadow:[^;]*var\(--accent-soft\)/);
});

test("backup creation uses credential-neutral backup wording", () => {
  assert.match(
    page,
    /ref=\{floatingActionPageRef\}[\s\S]{0,160}?className="admin-page admin-page--with-floating-actions backup-page"/
  );
  assert.match(
    page,
    /data-admin-floating-actions\s+type="button"\s+className="admin-btn admin-create-fab"\s+onClick=\{handleCreate\}[\s\S]*?<Plus size="1em" aria-hidden="true" \/>[\s\S]*?创建备份/
  );
  assert.match(page, /useAdminFloatingActionSpace<HTMLDivElement>\(\)/);
  assert.doesNotMatch(page, /<h2>备份列表<\/h2>/);
  assert.match(page, /show\("备份任务已开始", "success"\)/);
  assert.match(page, /<span>当前没有备份包<\/span>/);
  assert.doesNotMatch(
    page,
    /className="admin-btn is-primary"[\s\S]{0,240}?创建备份/
  );
  assert.match(css, /\.admin-create-fab\s*\{[^}]*position:\s*fixed;[^}]*right:\s*var\(--space-7\);[^}]*bottom:\s*var\(--space-5\);/s);
  assert.doesNotMatch(page, /创建完整备份|完整备份任务已开始|还没有完整备份/);
});

test("backup creation lets administrators choose a durable backup scope", () => {
  assert.match(page, /title="选择备份内容"/);
  for (const label of [
    "网盘凭证和对应视频资源",
    "爬虫脚本和对应的视频资源",
    "上传存储和对应视频资源",
    "本地存储和对应的视频资源",
    "用户信息",
  ]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /Object\.values\(backupSelection\)\.some\(Boolean\)/);
  assert.match(api, /export type BackupSelection/);
  assert.match(api, /function createBackup\(selection\?: BackupSelection\)/);
  assert.match(api, /JSON\.stringify\(selection\)/);
  assert.match(backupApiHandler, /ErrNoBackupContent/);
});

test("backup creation starts with every scope unchecked", () => {
  assert.match(
    page,
    /const EMPTY_BACKUP_SELECTION:[\s\S]*?cloudDrives: false,[\s\S]*?crawlerScripts: false,[\s\S]*?uploadStorage: false,[\s\S]*?localStorage: false,[\s\S]*?userInfo: false,/
  );
  assert.match(
    page,
    /function handleCreate\(\) \{\s*setBackupSelection\(\{ \.\.\.EMPTY_BACKUP_SELECTION \}\);/
  );
  assert.doesNotMatch(page, /FULL_BACKUP_SELECTION/);
});

test("backup cards disclose scope in a crawler-style inline panel", () => {
  assert.match(page, /function backupSelectionLabels/);
  assert.match(page, /backupSelectionLabels\(record\.selection\)/);
  assert.match(page, /const \[expandedBackupId, setExpandedBackupId\] = useState\(""\)/);
  assert.match(
    page,
    /className=\{`backup-record\$\{expanded \? " is-expanded" : ""\}`\}[\s\S]*?className="backup-record__main"[\s\S]*?aria-expanded=\{expanded\}/
  );
  assert.match(
    page,
    /className="backup-record__scope-trigger">[\s\S]*?\{scopeLabels\.length\} 项备份内容[\s\S]*?<ChevronDown size=\{14\} aria-hidden="true" \/>/
  );
  assert.match(
    page,
    /\{expanded && \([\s\S]*?className="backup-record__detail" aria-label="备份内容"[\s\S]*?className="backup-record__detail-scopes"[\s\S]*?scopeLabels\.map/
  );
  assert.doesNotMatch(page, /className="backup-scope-list" aria-label="备份范围"/);
  assert.match(
    css,
    /\.backup-record__detail\s*\{[^}]*display:\s*grid;[^}]*border-top:\s*1px dashed var\(--border-subtle\);[^}]*background:\s*var\(--bg-sunken\);/s
  );
  assert.match(
    css,
    /\.backup-record__detail-scopes\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\);/s
  );
  assert.doesNotMatch(css, /\.backup-record__detail-scope\s*\{[^}]*border(?:-radius)?:/s);
});

test("backup scope stays visible when choosing and confirming a restore", () => {
  assert.match(
    page,
    /<dt>恢复内容<\/dt>[\s\S]*?backupSelectionLabels\(restoreTarget\.selection\)/
  );
  assert.match(
    css,
    /\.backup-scope-list\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s
  );
  assert.match(
    css,
    /\.backup-scope\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-muted\);/s
  );
  assert.match(
    css,
    /\.backup-scope\s*\{[^}]*border:\s*1px solid var\(--border-default\);/s
  );
  assert.doesNotMatch(
    css,
    /\.backup-scope\s*\{[^}]*background:\s*var\(--(?:accent-soft|bg-elevated)\);/s
  );
  assert.match(
    css,
    /\.backup-restore-summary > \.backup-restore-summary__scope\s*\{[^}]*grid-column:\s*1 \/ -1;/s
  );
});

test("backup archives accept only the current protocol", () => {
  assert.match(backupTypes, /FormatVersion = 3/);
  assert.doesNotMatch(
    backupTypes,
    /ScopedFormatVersion|LegacyFormatVersion|UserConfig/
  );
  assert.match(
    backupArchive,
    /if manifest\.FormatVersion != FormatVersion \{[\s\S]*?unsupported format version/
  );
  assert.match(backupArchive, /if manifest\.Selection == nil/);
  assert.doesNotMatch(
    backupArchive,
    /ScopedFormatVersion|LegacyFormatVersion|EffectiveSelection/
  );
  assert.doesNotMatch(backupRestorePrepare, /\.IsFull\(\)|UserConfig/);
  assert.doesNotMatch(api, /userConfig/);
});

test("upload storage merges while each source local storage keeps an isolated namespace", () => {
  assert.match(backupRestoreMerge, /driveUsesMergeRestore/);
  assert.match(backupRestoreMerge, /restore_merged_drives/);
  assert.doesNotMatch(
    backupRestoreMerge,
    /DELETE FROM main\.remote_upload_jobs/
  );
  assert.doesNotMatch(backupRestoreMerge, /INSERT OR REPLACE/);
  assert.match(
    backupRestoreMerge,
    /INSERT OR IGNORE INTO main\.video_tags/
  );
  assert.match(backupRestoreAssets, /prepareMergedUploadStorage/);
  assert.match(
    backupRestoreAssets,
    /snapshotSource\(ctx, source, merged\)[\s\S]*?overlaySource\(ctx, target, merged\)/
  );
  assert.match(backupRestorePrepare, /prepareIsolatedLocalStorage/);
  assert.doesNotMatch(backupRestorePrepare, /prepareMergedLocalStorage/);
  assert.match(
    backupRestoreLocal,
    /fmt\.Sprintf\("localstorage-restore-%s-%03d", stageID, index\+1\)/
  );
  assert.match(backupRestoreLocal, /SourceDriveID/);
  assert.match(backupRestoreLocal, /rewriteLocalStorageCatalog/);
  assert.match(backupRestoreLocal, /videoid\.ForDrive\("localstorage", video\.newDriveID/);
  const isolatedLocalRestore = backupRestoreAssets.slice(
    backupRestoreAssets.indexOf("func prepareIsolatedLocalStorage"),
    backupRestoreAssets.indexOf("func overlaySource")
  );
  assert.doesNotMatch(
    isolatedLocalRestore,
    /preserve target local storage|overlaySource\(ctx, target, merged\)/
  );
});

test("backup creation dialog uses flat chrome without structural divider lines", () => {
  assert.match(
    css,
    /\.admin-modal\.admin-modal--backup-create\s*\{[^}]*width:\s*min\(520px,\s*100%\);[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s
  );
  assert.match(
    css,
    /\.admin-modal--backup-create \.admin-modal__header,\s*\.admin-modal--backup-create \.admin-modal__footer\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--bg-surface\);/s
  );
  assert.match(css, /\.backup-selection-option\s*\{[^}]*border:\s*0;/s);
  assert.doesNotMatch(
    css,
    /\.backup-selection-option:hover\s*\{[^}]*border-color:/s
  );
});

test("backup overview uses one full-width card with three evenly distributed metrics", () => {
  const overview = page.slice(
    page.indexOf('<section className="backup-overview"'),
    page.indexOf("{current && taskActive(current)")
  );

  assert.equal(overview.match(/className="backup-stat"/g)?.length, 3);
  assert.match(overview, /预计数据量[\s\S]*服务器可用空间[\s\S]*备份数量/);
  assert.match(
    css,
    /\.backup-overview\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[^}]*width:\s*100%;[^}]*border:\s*1px solid var\(--border-subtle\);[^}]*border-radius:\s*var\(--radius-md\);[^}]*background:\s*var\(--bg-surface\);/s
  );
  assert.match(
    css,
    /\.backup-stat\s*\{[^}]*justify-items:\s*center;[^}]*text-align:\s*center;/s
  );
  assert.match(
    css,
    /\.backup-stat \+ \.backup-stat\s*\{[^}]*border-left:\s*1px solid var\(--border-subtle\);/s
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width: 840px\)\s*\{[\s\S]*?\.backup-overview\s*\{[^}]*grid-template-columns:\s*1fr;/
  );
});

test("backup loading keeps the fixed page shell and leaves backend data blank", () => {
  assert.doesNotMatch(page, /AdminLoading|lds-ellipsis/);
  assert.doesNotMatch(page, /if \(loading && !data\)/);
  assert.match(
    page,
    /ref=\{floatingActionPageRef\}\s+className="admin-page admin-page--with-floating-actions backup-page"\s+aria-busy=\{loading \|\| undefined\}/
  );
  assert.match(
    page,
    /<section className="backup-overview"[\s\S]*?data \? formatBytes\(estimate\?\.totalBytes\) : null[\s\S]*?data \? formatBytes\(estimate\?\.availableBytes\) : null[\s\S]*?data \? data\.backups\.length : null/
  );
  assert.match(
    page,
    /<section className="admin-card backup-upload-card">[\s\S]*?<section className="backup-list-section">/
  );
  assert.match(
    page,
    /\{data\?\.backups\.length \? \([\s\S]*?className="backup-list"[\s\S]*?\) : data \? \([\s\S]*?className="backup-empty"[\s\S]*?\) : null\}/
  );
  assert.match(page, /disabled=\{!data \|\| creating \|\| taskActive\(current\)/);
  assert.match(
    css,
    /\.backup-stat strong\s*\{[^}]*min-height:\s*1\.2em;[^}]*line-height:\s*1\.2;/s
  );
});

test("migration upload uses resumable checkpoints and one whole-archive hash", () => {
  assert.doesNotMatch(api, /Content-Digest|X-Chunk-SHA256/);
  assert.match(api, /\/backup-uploads\/\$\{encodeURIComponent\(id\)\}\/chunks\/\$\{index\}/);
  assert.match(page, /sha256Blob\(selectedFile, hashController\.signal\)/);
  assert.doesNotMatch(page, /sha256Blob\(blob/);
  assert.match(page, /finalizeBackupUpload\(session\.id, archiveHash\)/);
  assert.match(api, /JSON\.stringify\(\{ sha256 \}\)/);
  assert.doesNotMatch(backupApiHandler, /Content-Digest|X-Chunk-SHA256/);
  assert.match(backupApiHandler, /Backups\.PutChunk\([\s\S]*?http\.MaxBytesReader/);
  assert.match(sha256, /import\("@noble\/hashes\/sha2\.js"\)/);
  assert.match(sha256, /sha256\.create\(\)/);
  assert.match(sha256, /8 \* 1024 \* 1024/);
  assert.doesNotMatch(sha256, /subtle\.digest|blob\.arrayBuffer\(\)/);
  assert.match(page, /localStorage\.setItem\(RESUME_KEY/);
  assert.match(page, /void handleUpload\(next\)/);
  assert.match(page, /file && upload[\s\S]{0,100}?void handleUpload\(file\)/);
  assert.match(page, /handlePause/);
  assert.match(page, /校验并入库/);
  assert.doesNotMatch(page, /正在合并并完整校验/);
});

test("server transfer uses parallel range streaming with scoped tokens and no automatic restore", () => {
  assert.match(api, /createBackupTransfer/);
  assert.match(api, /createBackupReceiveToken/);
  assert.match(page, /从服务器接收/);
  assert.match(page, /发送到其它服务器/);
  assert.doesNotMatch(page, /<Send size=\{14\} \/>\s*发送/);
  assert.match(page, /onClick=\{handleSendBackup\}\s*>\s*确认\s*<\/button>/);
  assert.doesNotMatch(page, /onClick=\{handleSendBackup\}\s*>\s*<(?:Send|Loader2)/);
  assert.doesNotMatch(page, /开始发送/);
  assert.doesNotMatch(page, /支持 HTTP 的 IP\+端口地址和 HTTPS 地址/);
  assert.match(backupTransferRoutes, /r\.Route\(backuptransfer\.PeerBackupPath/);
  assert.match(backupTransferTypes, /PeerBackupPath\s+=\s+"\/peer\/backups"/);
  assert.doesNotMatch(backupTransferTypes, /\/peer\/v\d+\/backups/);
  assert.match(backupTransferApi, /peerBearerToken\(r\)/);
  assert.match(backupTransferApi, /Content-Range/);
  assert.doesNotMatch(backupTransferApi, /Content-Digest|X-Chunk-SHA256/);
  assert.match(backupTransferSender, /scheme != "http" && scheme != "https"/);
  assert.match(backupTransferSender, /目标服务器仅支持 HTTP 或 HTTPS/);
  assert.doesNotMatch(backupTransferSender, /allowInsecure/);
  assert.match(backupTransferSender, /uploadRanges\(/);
  assert.match(backupTransferSender, /min\(ParallelStreams, capabilities\.ParallelStreams\)/);
  assert.match(backupTransferSender, /committedRanges\(status\)/);
  assert.match(viteConfig, /"\/peer": \{ target: backendTarget, xfwd: true \}/);
  assert.match(page, /http:\/\/192\.168\.1\.10:9191 或 https:\/\/target\.example\.com/);
  assert.match(
    page,
    /HTTP 会明文传输接收码和完整备份包，请确认两台服务器之间的网络链路可信\s*<\/span>/
  );
  assert.match(page, /<h2>服务器接收<\/h2>/);
  assert.match(
    page,
    /将这个一次性接收码给到发送方[\s\S]*?当前接收码有效至 \{formatTime\(receiveToken\?\.expiresAt\)\}，一个接收码只展示一次[\s\S]*?backup-receive-code__value/
  );
  assert.doesNotMatch(page, /将这个一次性接收码复制到源服务器/);
  assert.doesNotMatch(page, /title="从其它服务器接收"[\s\S]{0,500}?footer=/);
  assert.doesNotMatch(page, /未使用时有效至/);
  assert.doesNotMatch(page, /接收码只展示这一次|请勿通过不可信渠道传递/);
  assert.match(page, /下载 \{formatBytes\(transfer\.bytesPerSecond\)\}\/s/);
  assert.match(page, /上传 \{formatBytes\(transfer\.bytesPerSecond\)\}\/s/);
  assert.match(api, /listBackupReceiveTransfers/);
  assert.match(api, /cancelBackupReceiveTransfer[\s\S]*?\/backup-receives\/\$\{encodeURIComponent\(id\)\}[\s\S]*?method: "DELETE"/);
  assert.match(backupTransferRoutes, /r\.Delete\("\/backup-receives\/\{id\}", a\.handleCancelBackupReceiveTransfer\)/);
  assert.match(page, /handleCancelReceiveTransfer[\s\S]*?api\.cancelBackupReceiveTransfer\(id\)/);
  assert.match(page, /transfer\.cancellable[\s\S]{0,500}?handleCancelReceiveTransfer\(transfer\.id\)/);
  assert.match(page, /服务器接收已取消，临时文件正在清理/);
  assert.match(page, /visibleProgressTransfers\(transfers, transferActive\)/);
  assert.match(page, /visibleProgressTransfers\(receiveTransfers, receiveTransferActive\)/);
  assert.match(page, /filter\(\(transfer\) => transfer\.state === "failed"\)/);
  assert.doesNotMatch(page, /recentFinished/);
});

test("backup upload card keeps one server and one local entry action", () => {
  assert.match(
    page,
    /className="backup-upload-entry-actions"[\s\S]*?onClick=\{handleCreateReceiveToken\}[\s\S]*?从服务器接收[\s\S]*?onClick=\{handleLocalUploadEntry\}[\s\S]*?从本地上传/
  );
  assert.match(page, /ref=\{localFileInput\}[\s\S]{0,120}?type="file"[\s\S]{0,180}?hidden/);
  assert.match(page, /<FileIcon size=\{14\} \/>\s*从本地上传/);
  assert.match(fileIcon, /viewBox="0 0 384 512"/);
  assert.match(fileIcon, /M64 0C28\.7 0 0 28\.7 0 64L0 448/);
  assert.doesNotMatch(page, /16 MiB 分片上传，支持暂停与断点续传/);
  assert.doesNotMatch(page, /backup-file-picker|backup-upload-submit|选择 ZIP 备份包|开始上传|继续上传/);
  assert.match(
    css,
    /\.backup-upload-entry-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s
  );
  assert.match(
    css,
    /\.backup-upload-entry-actions \.admin-btn\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*40px;/s
  );
  assert.match(
    css,
    /\.backup-upload-actions \.admin-btn\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*40px;[^}]*padding-inline:\s*14px;/s
  );
  assert.doesNotMatch(css, /\.backup-file-picker|\.backup-upload-controls|\.backup-upload-submit/);
  assert.match(
    css,
    /@media \(max-width: 600px\)[\s\S]*?\.backup-upload-entry-actions\s*\{[^}]*grid-template-columns:\s*1fr;/s
  );
});

test("backup long operations render phase-driven task checklists", () => {
  assert.match(api, /export type BackupOperationProgress/);
  assert.match(api, /restoreProgress\?: BackupOperationProgress/);
  assert.match(page, /function BackupOperationChecklist/);
  assert.match(page, /upload\?\.progress\?\.phase/);
  assert.match(page, /data\?\.restoreProgress/);
  assert.match(page, /校验完整文件/);
  assert.match(page, /校验并解压暂存/);
  assert.match(page, /检查暂存数据库/);
  assert.doesNotMatch(page, /每个文件只读取一次/);
  assert.doesNotMatch(page, /生成可回滚的切换清单/);
  assert.match(css, /\.backup-operation-steps/);
  assert.match(css, /backup-progress-indeterminate/);
  assert.match(css, /backup-marker-breathe/);
  assert.match(css, /backup-check-pop/);
  assert.match(css, /prefers-reduced-motion/);
});

test("active backup task progress uses neutral status colors", () => {
  assert.match(
    css,
    /\.backup-task\s*\{[^}]*border:\s*1px solid var\(--border-subtle\);[^}]*background:\s*var\(--bg-surface\);/s
  );
  assert.match(
    css,
    /\.backup-task__percent\s*\{[^}]*color:\s*var\(--text-muted\);/s
  );
  assert.match(
    css,
    /\.backup-task \.backup-progress > span\s*\{[^}]*background:\s*var\(--text-muted\);/s
  );
});

test("active backup task keeps metrics, percentage, and cancellation above the progress bar", () => {
  const activeTask = page.slice(
    page.indexOf("{current && taskActive(current)"),
    page.indexOf('<div className="backup-grid">')
  );
  assert.match(
    activeTask,
    /className="backup-task__progress-row"[\s\S]*?className="backup-task__meta"[\s\S]*?className="backup-task__percent"[\s\S]*?onClick=\{handleCancelBackup\}[\s\S]*?className="backup-progress"/
  );
  assert.match(
    css,
    /\.backup-task__progress-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto;/s
  );
  assert.match(
    css,
    /\.backup-task__meta > span\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s
  );
});

test("active backup cancellation uses the transparent ordinary button style", () => {
  assert.match(
    page,
    /taskActive\(current\) && current\.cancellable[\s\S]*?className="admin-btn is-transparent"[\s\S]*?onClick=\{handleCancelBackup\}/
  );
  assert.doesNotMatch(page, /className="admin-btn is-stop" onClick=\{handleCancelBackup\}/);
  assert.match(
    css,
    /\.admin-btn\.is-transparent\s*\{[^}]*background:\s*transparent;/s
  );
  assert.match(
    css,
    /@media \(hover:\s*hover\) and \(pointer:\s*fine\)\s*\{\s*\.admin-btn\.is-transparent:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent;/s
  );
});

test("backup layout collapses safely on narrow screens", () => {
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.backup-stat/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.backup-upload-entry-actions/);
  assert.match(css, /@media \(max-width: 840px\)[\s\S]*?\.backup-record__line\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.backup-record__detail-scopes\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /\.backup-record__actions \.admin-btn[\s\S]*?flex: 1 1 110px/);
  assert.match(css, /\.admin-modal\.admin-modal--backup-restore[\s\S]*?width: min\(620px, 100%\)/);
});

test("supported deployments restart on the dedicated restore exit code", () => {
  assert.match(serverMain, /os\.Exit\(backup\.RestartExitCode\)/);
  assert.match(install, /RestartForceExitStatus=75/);
  assert.match(install, /VIDEO_RESTART_MANAGED=true/);
  assert.match(deploy, /RestartForceExitStatus=75/);
  assert.match(deploy, /VIDEO_RESTART_MANAGED=true/);
  assert.match(compose, /VIDEO_RESTART_MANAGED: "true"/);
  assert.match(compose, /restart: unless-stopped/);
});

test("deploy keeps systemd environment lines separate from LimitNOFILE", () => {
  assert.match(deploy, /\$\{env_lines\}\nLimitNOFILE=65536/);
  assert.doesNotMatch(deploy, /\$\{env_lines\}LimitNOFILE=65536/);
});

test("restore polling reports a missing durable restore only after its grace window", () => {
  assert.match(
    page,
    /const restoreInProgress =\s*backupState\.pendingRestore \|\| Boolean\(backupState\.restoreProgress\)/
  );
  assert.match(
    page,
    /!restoreInProgress[\s\S]*?RESTORE_CONFIRMATION_GRACE_MS[\s\S]*?未确认恢复已启动，当前数据保持不变，请重试/
  );
  assert.match(page, /未确认恢复已启动，当前数据保持不变，请重试/);
  assert.match(page, /restoreReport\?\.localStorageWarnings/);
  assert.match(page, /restoreReport\?\.missingAssets/);
});

test("successful restore invalidates cached auth before opening login", () => {
  assert.match(authContext, /invalidateSession:\s*\(\) => void/);
  assert.match(
    authContext,
    /const invalidateSession = useCallback\(\(\) => \{[\s\S]*?setStatus\("guest"\);[\s\S]*?setRole\(""\);/
  );
  const polling = page.slice(
    page.indexOf("const redirectToLogin"),
    page.indexOf("const current = data?.current")
  );
  assert.ok(
    polling.indexOf("invalidateSession();") < polling.indexOf('navigate("/login"'),
    "the shared auth state must become guest before LoginPage renders"
  );
  assert.match(polling, /!state\.authenticated[\s\S]*?redirectToLogin\(\)/);
});

test("restore polling starts only after validation and staging are accepted", () => {
  assert.match(page, /校验并解压暂存/);
  assert.match(
    page,
    /const \[restoreSubmitting, setRestoreSubmitting\] = useState\(false\)/
  );
  const handler = page.slice(
    page.indexOf("async function handleRestore()"),
    page.indexOf("function closeRestore()")
  );
  assert.ok(
    handler.indexOf("await api.restoreBackup") < handler.indexOf("setRestoring(true)"),
    "restart polling must not begin while the restore request is still staging"
  );
});
