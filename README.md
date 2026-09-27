# GLOBAL — BNB Testnet contract

قرارداد، تست‌ها و نصب اوبونتو برای پروژه GLOBAL. [راهنمای کامل فارسی](README.fa.md)

## Ubuntu

پس از clone مخزن و ورود به پوشه پروژه:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates xz-utils
bash ubuntu-setup.sh
```

آدرس `TEST-ONLY DEPLOYER` را فقط با tBNB آزمایشی تأمین کنید و سپس:

```bash
bash ubuntu-testnet.sh deploy
```

این مسیر توکن و منابع قیمت ساختگی برای BNB Testnet ایجاد می‌کند و برای پول واقعی نیست. مالک، هفت شریک و مقصد عملیاتی در `config.example.json` ثبت شده‌اند. کیف پول پرداخت‌کننده فقط روی سرور ساخته می‌شود. فایل‌های کلید، تنظیمات محرمانه، journal و runtime با `.gitignore` از Git کنار گذاشته شده‌اند. فقط گزارش `deployment-public.json` را به اشتراک بگذارید.

## Validation

43 contract tests passed locally; an additional local integration test covers the server deployer, ownership, chain restriction and resume behavior. Public-chain deployment has not been performed by this package's author. No independent audit has been completed.

## نصب مستقیم از گیت‌هاب

```bash
git clone https://github.com/Rezamoradifar/Gloucestershire.git ~/global-bnb
cd ~/global-bnb
bash ubuntu-setup.sh
# پس از تأمین tBNB کیف پول تست:
bash ubuntu-testnet.sh deploy
```

به‌روزرسانی نسخه، پس از بررسی تغییرات:

```bash
cd ~/global-bnb
git pull --ff-only
bash ubuntu-setup.sh
```

اجرای مجدد setup کلید موجود کیف پول تست را عوض نمی‌کند. با اجرای deploy رسیدهای قبلی بررسی می‌شوند؛ با تغییر تنظیمات سازنده، ادامه استقرار متوقف می‌شود.

`deployment-console/` صفحه استقرار مرورگری SafePal است؛ روی HTTPS میزبانی کنید. این صفحه با کیف پول مالک چهار تراکنش تستی می‌سازد و جایگزین روش سرور است. در روش سرور، کیف پول تست مستقل کارمزد را می‌پردازد. قرارداد فرانت تجاری و اجرای API دراپ‌شیپینگ را شامل نمی‌شود.

## تست عملی قرارداد مستقرشده

```bash
cd ~/global-bnb
git pull --ff-only
bash ubuntu-health.sh
```

این فرمان فقط به قرارداد `0x8C77C442F6CB8C2462a12bB395186be944259504` روی شبکه 97 وصل می‌شود. کلید مستقل تست روی همان سرور استفاده می‌شود. حداقل موجودی لازم: ۰٫۰۳ tBNB (۰٫۰۲ واریز آزمایشی و حاشیه کارمزد). ۱۰۰ توکن تست ساخته و واریز می‌شود؛ ۰٫۰۲ BNB آزمایشی هم واریز می‌شود. مقصدها واقعیِ همین قرارداد روی شبکه تست هستند. همه مبالغ آزمایشی‌اند.

اسکریپت پیش از تعامل، ورودی تراکنش‌های استقرار را با سورس کامپایل‌شده و آدرس‌های مالک/شرکا/عملیات تطبیق می‌دهد. منابع قیمت ساختگی در صورت نیاز تازه می‌شوند. تقسیم ۸۰/۱۰/۱۰، ثبت اصل، رد حداقل نامعتبر، قفل اصل و رد دسترسی‌های غیرمجاز بررسی می‌شوند. بررسی درخواست‌های مردود با شبیه‌سازی `eth_call` است و فقط خطای مشخص قرارداد به‌عنوان موفقیت پذیرفته می‌شود. امضای مالک، تسویه سود واقعی، پورسانت VIP و برداشت اصل پس از ۹۰ روز در این تست زنده انجام نمی‌شوند.

گزارش قابل ارسال:

```bash
cat .testnet-server/health-public.json
```

اجرای دوباره پس از موفقیت فقط نتیجه قبلی را نشان می‌دهد و واریز جدید نمی‌کند. اگر اجرا نیمه‌تمام یا ناموفق شد، فایل `health-run.json` را حذف نکنید؛ گزارش خطا را برای بررسی بفرستید. قطع اجرا ممکن است بعد از ارسال تراکنش رخ دهد. گزارش «completed» فقط پایان این مجموعه محدود تست است، نه تأیید امنیت کامل یا تضمین نقدینگی.
