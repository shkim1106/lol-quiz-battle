# Vercel 배포 가이드

## 1단계 — Pusher 계정 설정

1. https://pusher.com → 회원가입
2. **Channels** → "Create app"
3. 앱 이름 입력, Cluster는 **ap3** (아시아) 선택
4. 생성된 앱의 "App Keys" 탭에서 4가지 값 복사

## 2단계 — Upstash Redis 설정

1. https://console.upstash.com → 회원가입
2. "Create Database" → 이름 입력, Region: **ap-northeast-1** (도쿄)
3. 생성 후 "REST API" 탭에서 URL과 Token 복사

## 3단계 — Vercel 배포

```bash
# Vercel CLI 설치
npm install -g vercel

# 프로젝트 루트에서
vercel

# 환경변수 추가
vercel env add PUSHER_APP_ID
vercel env add PUSHER_KEY
vercel env add PUSHER_SECRET
vercel env add PUSHER_CLUSTER    # ap3
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN

# 재배포 (환경변수 적용)
vercel --prod
```

## 로컬 테스트

```bash
# .env.local 파일 생성 후 값 입력
cp .env.example .env.local

# vercel dev로 실행 (서버리스 환경 에뮬레이션)
vercel dev
```
