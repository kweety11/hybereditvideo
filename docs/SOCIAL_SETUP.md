# دليل تجهيز مفاتيح النشر على السوشيال ميديا (Social Setup)

الدليل ده بيشرح خطوة بخطوة إزاي تجيبي المفاتيح (Tokens) اللازمة عشان ClipWise ينشر
تلقائياً على **Instagram** و**Facebook** و**TikTok**. كل ده مرة واحدة بس.

> بعد ما تجمّعي المفاتيح: انسخي `.dev.vars.example` لملف اسمه `.dev.vars` واملي القيم.
> للنشر على السيرفر (Cloudflare) استخدمي: `npx wrangler secret put <KEY>`.
> ابدئي دايماً بـ `SOCIAL_DRY_RUN=true` (بيجرّب من غير ما ينشر فعلاً) لحد ما تتأكدي.

---

## 1) Instagram + Facebook (إعداد واحد بيغطّي الاتنين — نظام Meta)

إنستجرام وفيسبوك بيستخدموا **نفس التوكن** (Page Access Token).

### أ. تجهيز الحسابات
1. حوّلي حساب الإنستجرام لـ **Business/Creator**:
   تطبيق Instagram ← Settings ← Account type and tools ← Switch to professional account.
2. لازم يكون عندك **Facebook Page**، واربطي الإنستجرام بيها:
   إعدادات الصفحة ← Linked accounts ← Instagram ← اربطي الحساب.

### ب. إنشاء تطبيق Meta
3. ادخلي **developers.facebook.com** ← My Apps ← **Create App** ← اختاري نوع **Business**.
4. جوّه التطبيق، من Add Products فعّلي:
   - **Instagram Graph API** (أو Instagram)
   - **Facebook Login for Business**

### ج. استخراج التوكن والـ IDs
5. افتحي **Graph API Explorer** (developers.facebook.com/tools/explorer):
   - اختاري التطبيق بتاعك من القائمة.
   - اطلبي **User Access Token** بالصلاحيات دي:
     `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
     `pages_read_engagement`, `pages_manage_posts`, `business_management`.
6. حوّلي التوكن لـ **Long-Lived** (يعيش ~60 يوم) عبر:
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=<token>`
7. هاتي الـ IDs:
   - **Page ID + Page Token:** في الـ Explorer اعملي `GET /me/accounts`
     ← هيرجّع صفحاتك وكل صفحة معاها `id` و `access_token` (ده هو الـ **Page Access Token**).
   - **IG Business ID:** اعملي `GET /{page-id}?fields=instagram_business_account`.

### القيم اللي هتحطّيها
```
META_PAGE_ACCESS_TOKEN=<الـ Page Access Token من خطوة 7>
FB_PAGE_ID=<Page ID>
IG_BUSINESS_ID=<instagram_business_account id>
```

> ⚠️ **مهم:** للنشر الحقيقي (مش وضع التطوير) التطبيق محتاج **App Review** على
> `instagram_content_publish` و `pages_manage_posts`. لحد ما ده يتعمل، النشر بيشتغل
> بس على الحسابات المضافة كـ **Testers/Roles** في التطبيق (وده كفاية لتجربتك إنتي).

---

## 2) TikTok (Content Posting API)

1. ادخلي **developers.tiktok.com** ← سجّلي ← **Create an app**.
2. ضيفي منتج **Content Posting API**.
3. فعّلي الـ Scopes: `video.publish`, `video.upload`, `user.info.basic`.
4. عشان نقدر ننشر بالرابط (PULL_FROM_URL) لازم **تأكّدي ملكية الدومين/الرابط**
   (URL ownership / Domain verification) في إعدادات التطبيق.
5. اعملي تسجيل دخول (Login Kit / OAuth) لحسابك عشان تطلّعي **Access Token**.

### القيم اللي هتحطّيها
```
TIKTOK_ACCESS_TOKEN=<Access Token>
TIKTOK_PRIVACY_LEVEL=SELF_ONLY
```

> ⚠️ **شرط من تيك توك (مش مننا):** التطبيقات الجديدة بتكون **Unaudited**، يعني النشر
> بيبقى **لحسابك إنت بس** و**SELF_ONLY** (مرئي ليكي بس) لحد ما تيك توك يراجع التطبيق
> ويعتمده. بعد الاعتماد غيّري `TIKTOK_PRIVACY_LEVEL` لـ `PUBLIC_TO_EVERYONE`.

---

## 3) بعد ما تجهّزي كل حاجة

1. `cp .dev.vars.example .dev.vars` واملي القيم.
2. شغّلي البرنامج، وجرّبي فحص الاتصال:
   `POST /api/social/test-connection` ← المفروض يرجّع `ok` لكل منصّة جهّزتيها.
3. سيبي `SOCIAL_DRY_RUN=true` وجرّبي بوست (هيسجّل من غير نشر فعلي).
4. لما تطمئني، حطّي `SOCIAL_DRY_RUN=false` وانشري بوست تجريبي على حسابك.

| المفتاح | المنصّة | منين تجيبيه |
|---|---|---|
| `META_PAGE_ACCESS_TOKEN` | IG + FB | Graph Explorer ← `GET /me/accounts` |
| `IG_BUSINESS_ID` | Instagram | `GET /{page-id}?fields=instagram_business_account` |
| `FB_PAGE_ID` | Facebook | `GET /me/accounts` |
| `TIKTOK_ACCESS_TOKEN` | TikTok | Login Kit / OAuth |
| `TIKTOK_PRIVACY_LEVEL` | TikTok | `SELF_ONLY` (ساندبوكس) → `PUBLIC_TO_EVERYONE` (بعد الاعتماد) |
