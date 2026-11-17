package io.github.maruid.travel;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 여행 앱 전용 기능 (웹에서 registerPlugin('Travel') 로 부름)
 *   1: info (앱 기능 버전)
 *   2: keepAwake (화면 켜두기 — 앱이 열려 있는 동안 화면이 꺼지지 않음)
 *   3: getShared + 'shareReceived' 알림 (구글 지도 [공유] → 장소 추가), 화면 세로 고정
 *   4: saveImage (사진을 기기 앨범 Pictures/여행 에 저장)
 * 새 앱 기능을 넣으면 NATIVE_API 를 올림. 웹은 nativeApiLevel() 로 확인해서 없는 기능은 메뉴를 숨김
 * (꼭 필요한 기능이면 app-version.json 의 min_native_api 도 올려 옛 앱에 업데이트 안내)
 */
@CapacitorPlugin(name = "Travel")
public class TravelPlugin extends Plugin {

    static final int NATIVE_API = 4;

    // [공유]로 받은 글 (웹이 꺼낼 때까지 보관, 꺼내면 지움)
    private static String pendingShare = null;
    private static TravelPlugin instance = null;

    @Override
    public void load() {
        instance = this;
    }

    static void onShared(String text) {
        synchronized (TravelPlugin.class) { pendingShare = text; }
        TravelPlugin p = instance;
        if (p != null) p.notifyListeners("shareReceived", new JSObject());
    }

    @PluginMethod
    public void getShared(PluginCall call) {
        String text;
        synchronized (TravelPlugin.class) { text = pendingShare; pendingShare = null; }
        JSObject r = new JSObject();
        r.put("text", text);
        call.resolve(r);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("api", NATIVE_API);
        call.resolve(r);
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // 사진 저장: data(base64) · name · mime → Pictures/여행 (안드로이드 10 이상은 권한 없이 MediaStore)
    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("name", "trip-photo.webp");
        String mime = call.getString("mime", "image/webp");
        if (data == null || data.isEmpty()) { call.reject("NO_DATA"); return; }
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        final String fname = name;
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, fname);
                    v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                    v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/여행");
                    v.put(MediaStore.Images.Media.IS_PENDING, 1);
                    Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("INSERT_FAILED");
                    try (OutputStream os = cr.openOutputStream(uri)) {
                        if (os == null) throw new Exception("OPEN_FAILED");
                        os.write(bytes);
                    }
                    v.clear();
                    v.put(MediaStore.Images.Media.IS_PENDING, 0);
                    cr.update(uri, v, null, null);
                } else {
                    File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES), "여행");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("MKDIR_FAILED");
                    File f = new File(dir, fname);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                    MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, new String[] { mime }, null);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("SAVE_FAILED: " + e.getMessage());
            }
        }).start();
    }
}
