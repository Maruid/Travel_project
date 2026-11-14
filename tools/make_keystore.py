"""
안드로이드 앱 서명 키 만들기 (한 번만, 내 PC 에서)
  pip install cryptography
  python make_keystore.py

만드는 것 (이 파일과 같은 폴더):
  travel-release.p12          서명 키 (PKCS12). 잃어버리면 앱 업데이트를 못 함 → 두 곳 이상 백업
  travel-release.base64.txt   위 파일을 GitHub Secret 에 붙여 넣기 좋게 바꾼 것 (등록 후 지워도 됨)

GitHub → Settings → Secrets and variables → Actions → Secrets 에 등록:
  ANDROID_KEYSTORE_BASE64   = travel-release.base64.txt 내용
  ANDROID_KEYSTORE_PASSWORD = 아래에서 정한 비밀번호
  ANDROID_KEY_ALIAS         = travel
  ANDROID_KEY_PASSWORD      = 같은 비밀번호 (PKCS12 는 키와 저장소 비밀번호가 같음)

이 파일들과 비밀번호는 git 저장소·대화·메신저에 넣지 마세요.
"""
import base64
import datetime
import getpass
import os
import sys

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID
except ImportError:
    sys.exit('cryptography 가 필요해요: pip install cryptography')

ALIAS = 'travel'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'travel-release.p12')
B64 = os.path.join(HERE, 'travel-release.base64.txt')

if os.path.exists(OUT):
    sys.exit(f'이미 있어요: {OUT}\n새로 만들면 예전 키로 설치한 앱은 업데이트가 안 돼요. 정말 새로 만들려면 그 파일을 옮긴 뒤 다시 실행하세요.')

pw = os.environ.get('TRAVEL_KEY_PASSWORD') or getpass.getpass('비밀번호 (8자 이상): ')
if len(pw) < 8:
    sys.exit('비밀번호는 8자 이상으로 해 주세요.')
if not os.environ.get('TRAVEL_KEY_PASSWORD') and getpass.getpass('비밀번호 한 번 더: ') != pw:
    sys.exit('비밀번호가 서로 달라요.')

key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'travel'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Travel_project')])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365 * 30))   # 30년
        .sign(key, hashes.SHA256()))
data = pkcs12.serialize_key_and_certificates(ALIAS.encode(), key, cert, None, serialization.BestAvailableEncryption(pw.encode()))
with open(OUT, 'wb') as f:
    f.write(data)
with open(B64, 'w') as f:
    f.write(base64.b64encode(data).decode())
print(f'만들었어요:\n  {OUT}\n  {B64}\n별칭(ANDROID_KEY_ALIAS): {ALIAS}')
