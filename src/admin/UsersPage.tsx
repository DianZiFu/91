import { useState } from "react";
import {
  Ban,
  ChevronDown,
  Key,
  Plus,
  ShieldOff,
  Trash2,
} from "lucide-react";
import * as api from "./api";
import { useToast } from "@/components/ToastContext";
import { Modal } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";
import { PasswordInput } from "./PasswordInput";
import { useAdminFloatingActionSpace } from "./useAdminFloatingActionSpace";
import { useAdminRouteActive } from "./AdminRouteCache";
import { useAdminResource } from "./useAdminResource";
import { useAuth } from "./AuthContext";

type Tab = "users" | "ips";
const MIN_PASSWORD_LENGTH = 6;

export function UsersPage() {
  const floatingActionPageRef = useAdminFloatingActionSpace<HTMLDivElement>();
  const [tab, setTab] = useState<Tab>("users");
  const routeActive = useAdminRouteActive();
  const { invalidateSession } = useAuth();
  const userResource = useAdminResource(api.listUsers, {
    queryKey: "users", active: routeActive, intervalMs: null, initialData: [], onUnauthorized: invalidateSession,
  });
  const ipResource = useAdminResource(api.listBannedIPs, {
    queryKey: "banned-ips", active: routeActive, intervalMs: null, initialData: [], onUnauthorized: invalidateSession,
  });
  const { data: users, invalidate: refreshUsers } = userResource;
  const { data: ips, invalidate: refreshIPs } = ipResource;
  const resource = tab === "users" ? userResource : ipResource;
  const loading = resource.loading;
  const [showCreate, setShowCreate] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState("user");
  const [creating, setCreating] = useState(false);
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<api.AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [unbanIPConfirm, setUnbanIPConfirm] = useState<string | null>(null);
  const { show } = useToast();
  const createPasswordError =
    createPassword.length > 0 && createPassword.length < MIN_PASSWORD_LENGTH
      ? `密码至少 ${MIN_PASSWORD_LENGTH} 位`
      : "";
  const resetPasswordError =
    resetPasswordValue.length > 0 && resetPasswordValue.length < MIN_PASSWORD_LENGTH
      ? `密码至少 ${MIN_PASSWORD_LENGTH} 位`
      : "";

  async function handleCreate() {
    if (!createUsername.trim() || !createPassword || createPasswordError) return;
    setCreating(true);
    try {
      await api.createUser({
        username: createUsername.trim(),
        password: createPassword,
        role: createRole,
      });
      show("用户创建成功", "success");
      setShowCreate(false);
      setCreateUsername("");
      setCreatePassword("");
      setCreateRole("user");
      await refreshUsers();
    } catch (e) {
      show(e instanceof Error ? e.message : "创建用户失败", "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleBan(user: api.AdminUser) {
    try {
      if (user.banned) {
        await api.unbanUser(user.id);
        show("已解封用户", "success");
      } else {
        await api.banUser(user.id);
        show("已封禁用户", "success");
      }
      await refreshUsers();
    } catch (e) {
      show(e instanceof Error ? e.message : "操作失败", "error");
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await api.deleteUser(deleteConfirm.id);
      show("用户已删除", "success");
      setDeleteConfirm(null);
      await refreshUsers();
    } catch (e) {
      show(e instanceof Error ? e.message : "删除失败", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleResetPassword() {
    if (!resetPasswordId || !resetPasswordValue || resetPasswordError) return;
    setResetting(true);
    try {
      await api.resetPassword(resetPasswordId, resetPasswordValue);
      show("密码已重置", "success");
      setResetPasswordId(null);
      setResetPasswordValue("");
    } catch (e) {
      show(e instanceof Error ? e.message : "重置密码失败", "error");
    } finally {
      setResetting(false);
    }
  }

  function closeResetPassword() {
    setResetPasswordId(null);
    setResetPasswordValue("");
  }

  async function handleUnbanIP() {
    if (!unbanIPConfirm) return;
    try {
      await api.unbanIP(unbanIPConfirm);
      show("已解除IP封禁", "success");
      setUnbanIPConfirm(null);
      await refreshIPs();
    } catch (e) {
      show(e instanceof Error ? e.message : "解封失败", "error");
    }
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleString("zh-CN");
  }

  return (
    <div
      ref={floatingActionPageRef}
      className="admin-page admin-page--with-floating-actions"
      aria-busy={loading || undefined}
    >
      <div className="admin-users-toolbar">
        <div className="admin-users-tabs admin-tags-filter-tabs" role="tablist" aria-label="用户分组">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "users"}
            className={`admin-tags-filter-tab ${tab === "users" ? "is-active" : ""}`}
            onClick={() => setTab("users")}
          >
            <span className="admin-tags-filter-tab__text">用户列表</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ips"}
            className={`admin-tags-filter-tab ${tab === "ips" ? "is-active" : ""}`}
            onClick={() => setTab("ips")}
          >
            <span className="admin-tags-filter-tab__text">封禁IP</span>
          </button>
        </div>
      </div>

      {tab === "users" && (
        <button
          data-admin-floating-actions
          type="button"
          className="admin-btn admin-create-fab"
          onClick={() => setShowCreate(true)}
        >
          <Plus size="1em" aria-hidden="true" />
          新建用户
        </button>
      )}

      {resource.error && (
        <div className="admin-detail-error" role="alert">
          {resource.error}
          <button type="button" className="admin-btn" onClick={() => void resource.refresh()}>重试</button>
        </div>
      )}
      {!loading && tab === "users" && resource.ready && (
        <div className="admin-table-wrap admin-users-table-wrap">
          <table className="admin-table admin-users-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr className="admin-empty-row">
                  <td className="admin-empty-cell" colSpan={5}>暂无用户</td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <td className="admin-users-table__username" data-label="用户名">
                      <span className="admin-users-table__username-value">{u.username}</span>
                    </td>
                    <td className="admin-users-table__role" data-label="角色">
                      <span className={`admin-status ${u.role === "admin" ? "is-generating" : "is-pending"}`}>
                        {u.role === "admin" ? "管理员" : "普通用户"}
                      </span>
                    </td>
                    <td className="admin-users-table__state" data-label="状态">
                      {u.banned ? (
                        <span className="admin-status is-error">已封禁</span>
                      ) : (
                        <span className="admin-status is-ok">正常</span>
                      )}
                    </td>
                    <td className="admin-users-table__time" data-label="创建时间">
                      {formatTime(u.createdAt)}
                    </td>
                    <td className="admin-users-table__actions is-actions" data-label="操作">
                      <div className="admin-users-table__action-row">
                        <button
                          className="admin-btn admin-btn--small"
                          onClick={() => handleBan(u)}
                          title={u.banned ? "解封" : "封禁"}
                        >
                          {u.banned ? <ShieldOff size={14} /> : <Ban size={14} />}
                        </button>
                        <button
                          className="admin-btn admin-btn--small"
                          onClick={() => {
                            setResetPasswordId(u.id);
                            setResetPasswordValue("");
                          }}
                          title="重置密码"
                        >
                          <Key size={14} />
                        </button>
                        <button
                          className="admin-btn admin-btn--small is-danger"
                          onClick={() => setDeleteConfirm(u)}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === "ips" && resource.ready && (
        <div className="admin-table-wrap admin-users-table-wrap">
          <table className="admin-table admin-banned-ips-table">
            <thead>
              <tr>
                <th>IP 地址</th>
                <th>原因</th>
                <th>封禁时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {ips.length === 0 ? (
                <tr className="admin-empty-row">
                  <td className="admin-empty-cell" colSpan={4}>暂无封禁IP</td>
                </tr>
              ) : (
                ips.map((ip) => (
                  <tr key={ip.ip}>
                    <td className="admin-banned-ips-table__ip" data-label="IP 地址">
                      <code>{ip.ip}</code>
                    </td>
                    <td className="admin-banned-ips-table__reason" data-label="原因">
                      {ip.reason || "-"}
                    </td>
                    <td className="admin-banned-ips-table__time" data-label="封禁时间">
                      {formatTime(ip.createdAt)}
                    </td>
                    <td className="admin-banned-ips-table__actions is-actions" data-label="操作">
                      <button
                        className="admin-btn admin-btn--small"
                        onClick={() => setUnbanIPConfirm(ip.ip)}
                        title="解除封禁"
                      >
                        解除封禁
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Modal */}
      <Modal
        open={showCreate}
        title="创建用户"
        className="admin-modal--user-create"
        onClose={() => setShowCreate(false)}
        footer={
          <>
            <button className="admin-btn" onClick={() => setShowCreate(false)}>取消</button>
            <button
              className="admin-btn is-primary"
              onClick={handleCreate}
              disabled={creating || !createUsername.trim() || !createPassword || Boolean(createPasswordError)}
            >
              {creating ? "创建中..." : "创建"}
            </button>
          </>
        }
      >
        <div className="admin-form">
          <div className="admin-form__row">
            <label htmlFor="admin-create-username">用户名</label>
            <input
              id="admin-create-username"
              name="admin-create-username"
              autoComplete="off"
              value={createUsername}
              onChange={(e) => setCreateUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="admin-form__row">
            <label htmlFor="admin-create-password">密码</label>
            <PasswordInput
              id="admin-create-password"
              name="admin-create-password"
              autoComplete="new-password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              className={createPasswordError ? "is-invalid" : undefined}
              aria-invalid={createPasswordError ? "true" : undefined}
              aria-describedby={createPasswordError ? "admin-create-password-error" : undefined}
            />
            {createPasswordError && (
              <div className="admin-form__error" id="admin-create-password-error">
                {createPasswordError}
              </div>
            )}
          </div>
          <div className="admin-form__row">
            <label>角色</label>
            <div className="admin-form-select-wrap">
              <select
                className="admin-form-select"
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value)}
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
              <ChevronDown size={15} className="admin-form-select__icon" aria-hidden="true" />
            </div>
          </div>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={resetPasswordId !== null}
        title="重置密码"
        className="admin-modal--password-reset"
        onClose={closeResetPassword}
        footer={
          <>
            <button className="admin-btn" onClick={closeResetPassword}>取消</button>
            <button
              className="admin-btn is-primary"
              onClick={handleResetPassword}
              disabled={resetting || !resetPasswordValue || Boolean(resetPasswordError)}
            >
              {resetting ? "重置中..." : "重置"}
            </button>
          </>
        }
      >
        <div className="admin-form">
          <div className="admin-form__row">
            <label htmlFor="admin-reset-password">新密码</label>
            <PasswordInput
              id="admin-reset-password"
              name="admin-reset-password"
              autoComplete="new-password"
              value={resetPasswordValue}
              onChange={(e) => setResetPasswordValue(e.target.value)}
              autoFocus
              className={resetPasswordError ? "is-invalid" : undefined}
              aria-invalid={resetPasswordError ? "true" : undefined}
              aria-describedby={resetPasswordError ? "admin-reset-password-error" : undefined}
            />
            {resetPasswordError && (
              <div className="admin-form__error" id="admin-reset-password-error">
                {resetPasswordError}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmModal
        open={deleteConfirm !== null}
        title="删除用户"
        message={`确定要删除用户「${deleteConfirm?.username ?? ""}」吗？`}
        hideIcon
        danger
        modalClassName="admin-modal--user-delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(null)}
        loading={deleting}
      />

      {/* Unban IP Confirm */}
      <ConfirmModal
        open={unbanIPConfirm !== null}
        title="解除IP封禁"
        message={`确定要解除 IP「${unbanIPConfirm ?? ""}」的封禁吗？`}
        hideIcon
        modalClassName="admin-modal--ip-unban"
        onConfirm={handleUnbanIP}
        onCancel={() => setUnbanIPConfirm(null)}
      />
    </div>
  );
}
