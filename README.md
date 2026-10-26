# Vimo AI

Vimo AI is an AI-powered platform that transforms product images into professional advertising videos using AI video generation, Egyptian Arabic voiceovers, and automated creative production.

العميل بيرفع صورة المنتج ووصف قصير، وبياخد فيديو إعلاني 24 ثانية بصوت وكلام بالعامية المصرية، جاهز لتيك توك وريلز وفيسبوك. البيع بالفيديو: العميل بيشتري باقة، يحوّل فودافون كاش، والأدمن بيأكد التحويل فالرصيد يتضاف.

## إزاي الفيديو بيتعمل

1. **السكريبت:** نموذج لغة (OpenAI) بيشوف صورة المنتج والوصف ويكتب 3 مشاهد: Hook، مميزات، عرض ودعوة للشراء. كل مشهد فيه جملة مصرية مدتها حوالي 8 ثواني. لو `OPENAI_API_KEY` مش موجود، بيتكتب سكريبت من قالب ثابت.
2. **المشاهد:** كل مشهد بيتعمل من صورة المنتج نفسها (image-to-video) على fal.ai بنموذج Veo 3 Fast، اللي بيطلّع فيديو بصوت وكلام. البرومبت بيطلب يحافظ على شكل المنتج ولونه واللوجو، ومن غير كتابة على الشاشة.
3. **الدمج:** المشاهد التلاتة بتتجمع في فيديو واحد 24 ثانية بـ `ffmpeg-api/merge-videos` على fal.
4. **الحفظ:** الفيديو النهائي بيتنسخ في قاعدة البيانات عندنا (روابط fal مؤقتة).

قبل ما يدفع، العميل يقدر يضغط «شوف السكريبت الأول» ويقرا الكلام اللي هيتقال ويعدّله، وده مجاني (بحد 30 مرة في الساعة). ولو الفيديو طلع مش عاجبه، «اعمله تاني» بيعمل فيديو جديد بنفس الصورة والسكريبت ويخصم فيديو.

كل ده بيشتغل في الخلفية (worker كل 6 ثواني)، فالعميل يقدر يقفل الصفحة ويرجع يلاقي الفيديو. لو أي مشهد فشل بيتعاد مرة، ولو فشل تاني الفيديو بيتلغي والرصيد بيرجع للعميل تلقائي.

## الصفحات

| الصفحة | الرابط | فيها إيه |
| --- | --- | --- |
| الرئيسية | `/` | الفكرة، معرض «شوف شغلنا»، الخطوات، الأسعار، أسئلة شائعة |
| الدخول والتسجيل | `/auth` | تسجيل دخول وإنشاء حساب |
| لوحة العميل | `/app` | فيديو جديد، فيديوهاتي (مشاهدة وتحميل)، الرصيد والشحن |
| لوحة الأدمن | `/admin` | نظرة عامة، تأكيد أو رفض طلبات الشحن، العملاء وتعديل الرصيد، كل الفيديوهات واختيار اللي يظهر في معرض الصفحة الرئيسية |

## التشغيل

محتاج Node 20 أو أحدث وقاعدة بيانات PostgreSQL.

```bash
cp .env.example .env        # واملا DATABASE_URL و JWT_SECRET و FAL_KEY
npm install
npx prisma migrate deploy
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='كلمة-سر-قوية' ADMIN_NAME='Mahmoud' npm run admin:create
npm run dev                 # http://localhost:3000
```

### الرفع على Railway

1. New Project ثم Deploy from GitHub repo واختار الريبو ده، وضيف PostgreSQL للمشروع.
2. في Variables ضيف `DATABASE_URL` (من خدمة Postgres) و `JWT_SECRET` و `FAL_KEY` و `OPENAI_API_KEY` و `VODAFONE_CASH_NUMBER`.
3. `railway.json` فيه أمر التشغيل (`npm start`، اللي بيعمل `prisma migrate deploy` الأول) وفحص `/health`.
4. اعمل حساب الأدمن مرة واحدة: `railway run npm run admin:create` مع `ADMIN_EMAIL` و `ADMIN_PASSWORD`.

## الإعدادات المهمة

كل الإعدادات في `.env.example`. أهمها:

- `VODAFONE_CASH_NUMBER`: الرقم اللي العملاء بيحوّلوا عليه (الافتراضي 01113878767).
- `FAL_KEY`: من غيره العملاء مش هيقدروا يعملوا فيديوهات، والأدمن بيشوف تنبيه.
- `VIMO_PACKAGES`: الباقات والأسعار (JSON). الافتراضي زي EasyVideos: فيديو بـ 350، 3 بـ 800، 5 بـ 1200، 10 بـ 2000.
- `VIMO_VIDEO_MODEL`: نموذج الفيديو على fal. تقدر تجرب Kling بدل Veo عشان التكلفة، بس ساعتها الصوت مش هيبقى جوه الفيديو.
- `VIMO_CLIP_COUNT` و `VIMO_CLIP_SECONDS`: عدد المشاهد وطول كل واحد (3 × 8 = 24 ثانية).

## التكلفة

Veo 3 Fast بالصوت على fal سعره تقريبًا 0.10 لـ 0.15 دولار للثانية، يعني الفيديو الـ 24 ثانية بيتكلف حوالي 2.5 لـ 3.6 دولار. راجع [أسعار fal](https://fal.ai/pricing) قبل ما تحدد أسعارك، وظبط `VIMO_COST_PER_SECOND_USD` عشان لوحة الأدمن تحسب صح.

## الاختبارات

```bash
npm test                                         # اختبارات السكريبت والبرومبت
TEST_DATABASE_URL=postgresql://... npm test      # + اختبار كامل: تسجيل، شحن، تأكيد، فيديو، تحميل، ورجوع الرصيد لو فشل
```

الاختبار الكامل بيستخدم fal وهمي، فمبيصرفش أي فلوس. استخدم قاعدة بيانات فاضية للاختبار بس، لأنه بيمسح الجداول.

## هيكل المشروع

```
src/
  server.js            Express: الـ API والصفحات
  config.js            الإعدادات والباقات
  auth.js              الجلسة (JWT في cookie)
  routes/              auth, videos, wallet, admin
  services/
    videoJob.js        مراحل الفيديو والـ worker
    fal.js             fal.ai queue API
    script.js          السكريبت المصري وبرومبت كل مشهد
    credits.js         الرصيد وسجل الحركات
    storage.js         تخزين الصور والفيديوهات
prisma/                الجداول والـ migrations
public/                الواجهة (HTML/CSS/JS بالعربي RTL)
tests/
```
