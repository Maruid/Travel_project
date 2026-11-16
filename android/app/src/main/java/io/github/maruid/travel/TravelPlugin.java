package io.github.maruid.travel;

import android.view.WindowManager;
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
 * 새 앱 기능을 넣으면 NATIVE_API 를 올림. 웹은 nativeApiLevel() 로 확인해서 없는 기능은 메뉴를 숨김
 * (꼭 필요한 기능이면 app-version.json 의 min_native_api 도 올려 옛 앱에 업데이트 안내)
 */
@CapacitorPlugin(name = "Travel")
public class TravelPlugin extends Plugin {

    static final int NATIVE_API = 3;

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
}
