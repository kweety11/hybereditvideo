import { useCallback, useEffect, useState } from 'react';
import {
  Share2,
  RefreshCw,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

type Platform = 'instagram' | 'facebook' | 'tiktok';

interface Segment {
  rank: number;
  title: string;
  year: number;
  summary: string;
  onScreenText?: string;
  sceneUrl?: string;
}
interface Episode {
  id: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  coverPrompt: string;
  segments: Segment[];
}
interface ConnectionStatus {
  platform: Platform;
  configured: boolean;
  ok: boolean;
  detail?: string;
}
interface PublishResult {
  platform: Platform;
  success: boolean;
  platformPostId?: string;
  error?: string;
  dryRun?: boolean;
}
interface JobPost {
  id: string;
  caption: string;
  platforms: Platform[];
  videoUrl: string;
  scheduledAt: number;
  status: string;
  results: PublishResult[] | null;
  error: string | null;
}

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'tiktok'];
const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-amber-400 bg-amber-500/10',
  published: 'text-emerald-400 bg-emerald-500/10',
  partial: 'text-orange-400 bg-orange-500/10',
  failed: 'text-red-400 bg-red-500/10',
};

export default function SocialPublisherPanel() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeId, setEpisodeId] = useState<string>('');
  const [caption, setCaption] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({
    instagram: true,
    facebook: true,
    tiktok: true,
  });

  const [connections, setConnections] = useState<ConnectionStatus[] | null>(null);
  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSeries = useCallback(async () => {
    try {
      const res = await fetch('/api/social/series');
      const data = await res.json();
      setEpisodes(data?.series?.episodes ?? []);
    } catch {
      // series is optional; ignore load failure
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/social/jobs');
      const data = await res.json();
      setJobs(data?.posts ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSeries();
    loadJobs();
  }, [loadSeries, loadJobs]);

  const testConnection = useCallback(async () => {
    setBusy('test');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/social/test-connection', { method: 'POST' });
      const data = await res.json();
      setConnections(data?.platforms ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل فحص الاتصال');
    } finally {
      setBusy(null);
    }
  }, []);

  const selectEpisode = useCallback(
    (id: string) => {
      setEpisodeId(id);
      const ep = episodes.find((e) => e.id === id);
      if (ep) {
        const tags = (ep.hashtags || []).join(' ');
        setCaption(tags ? `${ep.caption}\n\n${tags}` : ep.caption);
      }
    },
    [episodes]
  );

  const selectedPlatforms = (): Platform[] => PLATFORMS.filter((p) => platforms[p]);

  const schedule = useCallback(async () => {
    setError(null);
    setMessage(null);
    const chosen = selectedPlatforms();
    if (!videoUrl.trim()) return setError('لازم تحطي رابط الفيديو (public URL).');
    if (!caption.trim()) return setError('لازم تكتبي كابشن.');
    if (chosen.length === 0) return setError('اختاري منصّة واحدة على الأقل.');

    setBusy('schedule');
    try {
      const scheduledAt = scheduledLocal ? new Date(scheduledLocal).getTime() : undefined;
      const res = await fetch('/api/social/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: [{ caption, videoUrl, platforms: chosen, scheduledAt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'فشلت الجدولة');
      setMessage(scheduledAt ? 'اتجدول ✅ هيتنشر في معاده.' : 'اتضاف للطابور ✅ هيتنشر في أقرب دورة.');
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشلت الجدولة');
    } finally {
      setBusy(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, caption, platforms, scheduledLocal, loadJobs]);

  const publishNow = useCallback(
    async (postId: string) => {
      setBusy(`publish-${postId}`);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch('/api/social/publish-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'فشل النشر');
        setMessage('تم تنفيذ النشر — شوفي الحالة تحت.');
        await loadJobs();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'فشل النشر');
      } finally {
        setBusy(null);
      }
    },
    [loadJobs]
  );

  return (
    <div className="flex flex-col h-full bg-zinc-900/80 text-zinc-200">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b border-zinc-800/50">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-r from-orange-400 to-amber-300 flex items-center justify-center">
          <Share2 className="w-4 h-4 text-zinc-900" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">Social Publisher</h3>
          <p className="text-[11px] text-zinc-500">نشر وجدولة على إنستجرام / فيسبوك / تيك توك</p>
        </div>
        <button
          onClick={loadJobs}
          className="p-1.5 rounded-md hover:bg-zinc-800/50 text-zinc-400"
          title="تحديث"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Connection test */}
        <div className="space-y-2">
          <button
            onClick={testConnection}
            disabled={busy === 'test'}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 text-sm disabled:opacity-50"
          >
            {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            فحص الاتصال بالحسابات
          </button>
          {connections && (
            <div className="space-y-1">
              {connections.map((c) => (
                <div key={c.platform} className="flex items-center gap-2 text-xs">
                  {c.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : c.configured ? (
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  <span className="font-medium">{PLATFORM_LABEL[c.platform]}</span>
                  <span className="text-zinc-500 truncate">{c.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800/50" />

        {/* Episode picker */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">اختاري حلقة جاهزة (اختياري)</label>
          <select
            value={episodeId}
            onChange={(e) => selectEpisode(e.target.value)}
            className="w-full bg-zinc-800/70 rounded-lg px-3 py-2 text-sm border border-zinc-700/50 focus:border-orange-500/50 outline-none"
          >
            <option value="">— بدون —</option>
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.title}
              </option>
            ))}
          </select>
        </div>

        {/* Caption */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">الكابشن</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            placeholder="اكتبي الكابشن أو اختاري حلقة جاهزة فوق…"
            className="w-full bg-zinc-800/70 rounded-lg px-3 py-2 text-sm border border-zinc-700/50 focus:border-orange-500/50 outline-none resize-none"
          />
        </div>

        {/* Video URL */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">رابط الفيديو (public URL)</label>
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://…/reel.mp4"
            className="w-full bg-zinc-800/70 rounded-lg px-3 py-2 text-sm border border-zinc-700/50 focus:border-orange-500/50 outline-none"
            dir="ltr"
          />
        </div>

        {/* Platforms */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">المنصّات</label>
          <div className="flex gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => setPlatforms((prev) => ({ ...prev, [p]: !prev[p] }))}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  platforms[p]
                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                    : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400'
                }`}
              >
                {PLATFORM_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule time */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> معاد النشر (سيبيه فاضي = أقرب دورة)
          </label>
          <input
            type="datetime-local"
            value={scheduledLocal}
            onChange={(e) => setScheduledLocal(e.target.value)}
            className="w-full bg-zinc-800/70 rounded-lg px-3 py-2 text-sm border border-zinc-700/50 focus:border-orange-500/50 outline-none"
            dir="ltr"
          />
        </div>

        <button
          onClick={schedule}
          disabled={busy === 'schedule'}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-orange-400 to-amber-300 text-zinc-900 font-semibold text-sm disabled:opacity-50"
        >
          {busy === 'schedule' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          جدولة / إضافة للطابور
        </button>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {message && <p className="text-xs text-emerald-400">{message}</p>}

        {/* Jobs list */}
        <div className="border-t border-zinc-800/50 pt-3">
          <h4 className="text-xs font-semibold text-zinc-400 mb-2">البوستات ({jobs.length})</h4>
          <div className="space-y-2">
            {jobs.length === 0 && <p className="text-xs text-zinc-600">لسه مفيش بوستات.</p>}
            {jobs.map((job) => (
              <div key={job.id} className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[job.status] || 'text-zinc-400 bg-zinc-700/30'}`}>
                    {job.status}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {(job.platforms || []).map((p) => PLATFORM_LABEL[p]).join(' · ')}
                  </span>
                  {job.status === 'pending' && (
                    <button
                      onClick={() => publishNow(job.id)}
                      disabled={busy === `publish-${job.id}`}
                      className="ml-auto text-[10px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 disabled:opacity-50"
                    >
                      {busy === `publish-${job.id}` ? 'جارٍ…' : 'انشر دلوقتي'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-zinc-300 line-clamp-2">{job.caption}</p>
                {job.error && <p className="text-[10px] text-red-400">{job.error}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
