import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../api.jsx';
import { Card, CardHeader, Button, Field, Input, Empty } from '../components/ui.jsx';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [proxyUrl, setProxyUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setProxyUrl(s.proxyUrl || '');
      })
      .catch((e) => setError(e.message));
  }, []);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const s = await api.saveSettings({ proxyUrl });
      setSettings(s);
      flash('设置已保存，立即生效');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !settings) return <Empty text={`加载失败: ${error}`} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">设置</h2>
        <p className="mt-0.5 text-sm text-zinc-500">全局配置，保存后立即生效，无需重启</p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="网络代理" desc="用于访问被 DNS 污染或拦截的站点（当前 AgentRouter 使用）" />
        <div className="space-y-4 p-5">
          <Field
            label="代理地址"
            hint="格式 http://主机:端口，如 http://127.0.0.1:2080。留空时自动探测本机系统代理（仅 Windows），探测不到则直连"
          >
            <Input
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://127.0.0.1:2080"
            />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" onClick={save} disabled={saving}>
              <Save size={15} /> {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
