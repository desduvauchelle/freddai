package com.freddai.parityprobe;

import android.app.Instrumentation;
import android.os.Bundle;
import android.util.Xml;
import android.view.accessibility.AccessibilityNodeInfo;
import org.xmlpull.v1.XmlSerializer;
import java.io.StringWriter;

/** Reads native accessibility immediately, without UIAutomator's animation-idle wait. */
public final class TreeProbe extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            AccessibilityNodeInfo root = null;
            for (int attempt = 0; attempt < 30 && root == null; attempt++) {
                root = getUiAutomation().getRootInActiveWindow();
                if (root == null) android.os.SystemClock.sleep(100);
            }
            if (root == null) throw new IllegalStateException("No active accessibility root");
            StringWriter output = new StringWriter();
            XmlSerializer xml = Xml.newSerializer(); xml.setOutput(output);
            xml.startTag(null, "hierarchy"); visit(root, xml); xml.endTag(null, "hierarchy"); xml.flush();
            result.putString("tree", output.toString()); finish(-1, result);
        } catch (Exception error) { result.putString("error", error.toString()); finish(0, result); }
    }
    private void visit(AccessibilityNodeInfo node, XmlSerializer xml) throws Exception {
        if (!node.isVisibleToUser()) return;
        xml.startTag(null, "node");
        xml.attribute(null, "text", node.getText() == null ? "" : node.getText().toString());
        xml.attribute(null, "content-desc", node.getContentDescription() == null ? "" : node.getContentDescription().toString());
        xml.attribute(null, "class", node.getClassName() == null ? "" : node.getClassName().toString());
        xml.attribute(null, "enabled", String.valueOf(node.isEnabled()));
        android.graphics.Rect bounds = new android.graphics.Rect(); node.getBoundsInScreen(bounds);
        xml.attribute(null, "bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]");
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child != null) visit(child, xml);
        }
        xml.endTag(null, "node");
    }
}
