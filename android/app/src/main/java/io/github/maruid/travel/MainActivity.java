package io.github.maruid.travel;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TravelPlugin.class);
        super.onCreate(savedInstanceState);
        takeShare(getIntent());
    }

    // 앱이 떠 있을 때 [공유]로 다시 들어옴 (launchMode singleTask)
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        takeShare(intent);
    }

    // 구글 지도 등에서 [공유] → 여행 : 글(링크)을 TravelPlugin 에 맡김 → 웹이 getShared 로 꺼냄
    private void takeShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return;
        TravelPlugin.onShared(text);
        intent.setAction(Intent.ACTION_MAIN);   // 화면을 돌려도 같은 공유를 두 번 받지 않게
    }
}
