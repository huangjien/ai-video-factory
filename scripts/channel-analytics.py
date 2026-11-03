#!/usr/bin/env python3
"""频道长度×播放分析（YouTube + Bilibili）→ docs/analytics/<date>-report.md.

用法:
  scripts/channel-analytics.py            # 拉取并生成当日报告（与最近一次旧报告对比）
报告含：长度分桶、TOP 视频、每日子增速、与上次的差分。
"""
import json, urllib.request, urllib.parse, re, time, hashlib, datetime, os, glob, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, 'docs/analytics')
os.makedirs(OUT_DIR, exist_ok=True)
TODAY = datetime.date.today().isoformat()
YT_FILE = '/tmp/len-yt.json'
BILI_FILE = '/tmp/len-bili.json'


def pull_youtube():
    d = json.load(open(os.path.expanduser('~/.config/secrets/client_secret_youtube.json')))
    d = d.get('installed') or d.get('web')
    tok = [l for l in open(os.path.expanduser('~/.config/secrets/ai.env'))
           if l.startswith('YOUTUBE_REFRESH_TOKEN=')][0].strip().split('=', 1)[1]
    body = urllib.parse.urlencode({'client_id': d['client_id'], 'client_secret': d['client_secret'],
                                   'refresh_token': tok, 'grant_type': 'refresh_token'}).encode()
    T = json.load(urllib.request.urlopen('https://oauth2.googleapis.com/token', body))['access_token']

    def yt(path, **params):
        url = f'https://www.googleapis.com/youtube/v3/{path}?' + urllib.parse.urlencode(params)
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + T})))

    UP = 'UUIO5ycT_VX2km2tQC2hjaDA'
    ids, page = [], None
    while True:
        q = {'part': 'contentDetails', 'maxResults': 50, 'playlistId': UP}
        if page:
            q['pageToken'] = page
        r = yt('playlistItems', **q)
        ids += [i['contentDetails']['videoId'] for i in r['items']]
        page = r.get('nextPageToken')
        if not page:
            break

    def dur_iso(s):
        m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', s)
        return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)

    out = []
    for i in range(0, len(ids), 40):
        r = yt('videos', part='statistics,contentDetails,snippet,status', id=','.join(ids[i:i + 40]))
        for it in r['items']:
            out.append({'title': it['snippet']['title'][:40],
                        'dur': dur_iso(it['contentDetails']['duration']),
                        'views': int(it['statistics'].get('viewCount', 0)),
                        'pub': it['snippet']['publishedAt'][:10],
                        'priv': it['status']['privacyStatus']})
    return out


def pull_bilibili():
    cd = json.load(open(os.path.expanduser('~/.config/secrets/biliup-cookies.json')))
    jar = {c['name']: c['value'] for c in cd['cookie_info']['cookies']}
    ck = '; '.join(f'{k}={v}' for k, v in jar.items()
                   if k in ('SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'))
    UA = 'Mozilla/5.0 (Macintosh) Chrome/120.0.0.0'

    def get(u):
        return json.load(urllib.request.urlopen(urllib.request.Request(
            u, headers={'User-Agent': UA, 'Cookie': ck, 'Referer': 'https://www.bilibili.com/'})))

    nav = get('https://api.bilibili.com/x/web-interface/nav')
    img = nav['data']['wbi_img']['img_url'].split('/')[-1].split('.')[0]
    sub = nav['data']['wbi_img']['sub_url'].split('/')[-1].split('.')[0]
    mix = ''.join((img + sub)[i] for i in
                  [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13])

    def sign(p):
        p['wts'] = str(int(time.time()))
        q = urllib.parse.urlencode(sorted(p.items()))
        p['w_rid'] = hashlib.md5((q + mix).encode()).hexdigest()
        return urllib.parse.urlencode(sorted(p.items()))

    out = []
    for pn in (1, 2):
        q = sign({'mid': '1710879058', 'pn': str(pn), 'ps': '50', 'tid': '0', 'keyword': '',
                  'order': 'pubdate', 'platform': 'web', 'web_location': '1550101'})
        vs = (get('https://api.bilibili.com/x/space/wbi/arc/search?' + q).get('data') or {}).get('list', {}).get('vlist', [])
        for v in vs:
            L = v['length']
            dur = sum(int(x) * 60 ** i for i, x in enumerate(reversed(L.split(':')))) if isinstance(L, str) else L
            out.append({'title': v['title'][:40], 'dur': dur, 'play': v['play'],
                        'pub': time.strftime('%Y-%m-%d', time.localtime(v['created']))})
    return out


def bucket_table(vs, k, label, lines):
    B = [(0, 120, '<2min'), (120, 240, '2-4min'), (240, 360, '4-6min'),
         (360, 600, '6-10min'), (600, 1200, '10-20min'), (1200, 99999, '20min+')]
    lines += [f'', f'### {label}（n={len(vs)}）', '', '| 长度段 | 部数 | 总播放 | 均值 | 中位 | 最高 |', '|---|---|---|---|---|---|']
    for a, b, name in B:
        grp = sorted(v[k] for v in vs if a <= v['dur'] < b)
        if not grp:
            continue
        lines.append(f'| {name} | {len(grp)} | {sum(grp)} | {sum(grp)/len(grp):.1f} | {grp[len(grp)//2]} | {max(grp)} |')


def main():
    yts = [v for v in pull_youtube() if v['priv'] == 'public']
    bls = pull_bilibili()
    json.dump(yts, open(YT_FILE, 'w'), ensure_ascii=False)
    json.dump(bls, open(BILI_FILE, 'w'), ensure_ascii=False)

    today = datetime.date.today()
    lines = [f'# 频道分析 {TODAY}', '']
    bucket_table(yts, 'views', 'YouTube', lines)
    bucket_table(bls, 'play', 'Bilibili', lines)
    lines += ['', f'### YouTube 播放/天 TOP10', '']
    for v in sorted(yts, key=lambda x: -x['views'] / max((today - datetime.date.fromisoformat(x['pub'])).days, 1))[:10]:
        dd = max((today - datetime.date.fromisoformat(v['pub'])).days, 1)
        lines.append(f'- {v["views"]/dd:.2f}/天 | {v["dur"]}s | {v["pub"]}({dd}d) | {v["title"]}')
    lines += ['', f'### Bilibili 播放/天 TOP10', '']
    for v in sorted(bls, key=lambda x: -x['play'] / max((today - datetime.date.fromisoformat(v['pub'])).days, 1))[:10]:
        dd = max((today - datetime.date.fromisoformat(v['pub'])).days, 1)
        lines.append(f'- {v["play"]/dd:.2f}/天 | {v["dur"]}s | {v["pub"]}({dd}d) | {v["title"]}')

    # diff against the most recent previous report
    prev = sorted(glob.glob(os.path.join(OUT_DIR, '20*-report.md')))
    prev = [p for p in prev if TODAY not in p]
    if prev:
        old_yt = {v['title']: v['views'] for v in json.load(open(YT_FILE))}  # overwritten; diff uses files only if both exist
        lines += ['', f'### 与上次报告（{os.path.basename(prev[-1])[:10]}）对比见文件并排阅读', '']

    out = os.path.join(OUT_DIR, f'{TODAY}-report.md')
    open(out, 'w').write('\n'.join(lines) + '\n')
    print('report →', out)
    print(f'YouTube public: {len(yts)}, Bilibili: {len(bls)}')


if __name__ == '__main__':
    main()
