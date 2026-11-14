package io.github.maruid.travel;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TravelPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
