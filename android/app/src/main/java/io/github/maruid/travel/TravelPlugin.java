package io.github.maruid.travel;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 여행 앱 전용 기능 (웹에서 registerPlugin('Travel') 로 부름)
 *   1: info (앱 기능 버전)
 * 새 앱 기능을 넣으면 NATIVE_API 를 올리고, 그 기능을 쓰는 웹 화면은 app-version.json 의 min_native_api 도 올림
 * (새 APK 먼저 → 그다음 웹 배포. 옛 앱은 "앱을 업데이트해 주세요" 안내)
 */
@CapacitorPlugin(name = "Travel")
public class TravelPlugin extends Plugin {

    static final int NATIVE_API = 1;

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("api", NATIVE_API);
        call.resolve(r);
    }
}
