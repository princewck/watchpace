package org.example.tvchallenge;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.Layout;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Native typography over a light, animated shader background; no bitmap text or blur. */
final class BreakScreenView extends FrameLayout {

  private static final int WHITE = 0xff18223d;
  private static final int SAGE = 0xff465371;
  private final RestBackground background;
  private final LinearLayout content;
  private final TextView title;
  private final TextView reason;
  private final TextView next;
  private final TextView note;
  private final BreakStatusIcon status;
  private final BreakStatusIcon action;
  private final View divider;
  private final LinearLayout actionRow;
  private int heading;
  private float scale = 1;
  private int measuredWidth;
  private int measuredHeight;

  BreakScreenView(Context context) {
    this(context, -1);
  }

  BreakScreenView(Context context, int theme) {
    super(context);
    setBackgroundColor(0xfff4f6ff);
    android.app.ActivityManager manager =
      (android.app.ActivityManager) context.getSystemService(
        Context.ACTIVITY_SERVICE
      );
    boolean supportsGL =
      manager != null &&
      manager.getDeviceConfigurationInfo().reqGlEsVersion >= 0x30000;
    background = !supportsGL
      ? null
      : theme < 0
        ? new RestBackground(context)
        : new RestBackground(context, theme);
    if (background != null) addView(background, new LayoutParams(-1, -1));

    View shade = new View(context);
    shade.setBackground(
      new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[] {
        0xe8f5f7ff,
        0xc2f5f7ff,
        0x00f5f7ff,
      })
    );
    shade.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    addView(shade, new LayoutParams(-1, -1));

    content = new LinearLayout(context);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.START);
    addView(content, new LayoutParams(-2, -2, Gravity.CENTER_VERTICAL));
    status = new BreakStatusIcon(context, true);
    content.addView(status);
    title = text(WHITE, "sans-serif-light");
    title.setLetterSpacing(0.025f);
    if (android.os.Build.VERSION.SDK_INT >= 28) {
      title.setAccessibilityHeading(true);
    }
    content.addView(title);
    reason = text(SAGE, "sans-serif");
    content.addView(reason);
    divider = new View(context);
    divider.setBackgroundColor(0x28364266);
    content.addView(divider);

    actionRow = new LinearLayout(context);
    actionRow.setOrientation(LinearLayout.HORIZONTAL);
    actionRow.setGravity(Gravity.TOP);
    action = new BreakStatusIcon(context, false);
    actionRow.addView(action);
    next = text(WHITE, "sans-serif");
    actionRow.addView(next);
    content.addView(actionRow);
    note = text(SAGE, "sans-serif");
    content.addView(note);
  }

  private TextView text(int color, String family) {
    TextView view = new TextView(getContext());
    view.setTextColor(color);
    view.setTypeface(Typeface.create(family, Typeface.NORMAL));
    view.setIncludeFontPadding(false);
    view.setLineSpacing(0, 1.18f);
    view.setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE);
    return view;
  }

  RestBackground backgroundForTest() {
    return background;
  }

  void show(int heading, int message) {
    if (this.heading == heading) return;
    this.heading = heading;
    title.setText(heading);
    String[] lines = getResources().getString(message).split("\n", 3);
    reason.setText(lines[0]);
    next.setText(lines.length > 1 ? lines[1] : "");
    note.setText(lines.length > 2 ? lines[2] : "");
    note.setVisibility(lines.length > 2 ? VISIBLE : GONE);
    int kind = BreakStatusIcon.REST;
    int actionKind = BreakStatusIcon.PHONE;
    if (heading == R.string.break_pause_title) kind = BreakStatusIcon.PAUSE;
    if (heading == R.string.break_limit_title) kind = BreakStatusIcon.CLOCK;
    if (heading == R.string.break_rest_title) actionKind =
      BreakStatusIcon.CLOCK;
    if (heading == R.string.break_allow_title) {
      kind = BreakStatusIcon.CHECK;
      actionKind = BreakStatusIcon.BACK;
    }
    if (heading == R.string.break_wait_title) kind = BreakStatusIcon.WAIT;
    status.setKind(kind);
    action.setKind(actionKind);
  }

  void setActive(boolean active) {
    status.setActive(active);
    if (background != null) background.setActive(active);
  }

  @Override
  protected void onMeasure(int widthSpec, int heightSpec) {
    int width = MeasureSpec.getSize(widthSpec);
    int height = MeasureSpec.getSize(heightSpec);
    if (width != measuredWidth || height != measuredHeight) {
      measuredWidth = width;
      measuredHeight = height;
      sizeContent(width, height);
    }
    super.onMeasure(widthSpec, heightSpec);
  }

  private void sizeContent(int w, int h) {
    scale = Math.min(w / 1920f, h / 1080f);
    float fontScale = Math.min(
      getResources().getConfiguration().fontScale,
      1.25f
    );
    LayoutParams frame = (LayoutParams) content.getLayoutParams();
    frame.width = px(1370);
    frame.leftMargin = Math.round((w - 1920 * scale) / 2) + px(148);
    content.setLayoutParams(frame);
    status.setLayoutParams(row(88, 88, 0));
    title.setTextSize(TypedValue.COMPLEX_UNIT_PX, 68 * scale * fontScale);
    title.setLayoutParams(row(-1, -2, 34));
    reason.setTextSize(TypedValue.COMPLEX_UNIT_PX, 32 * scale * fontScale);
    reason.setLayoutParams(row(-1, -2, 24));
    divider.setLayoutParams(row(620, 1, 42));
    actionRow.setLayoutParams(row(-1, -2, 32));
    LinearLayout.LayoutParams icon = row(30, 38, 0);
    icon.rightMargin = px(18);
    action.setLayoutParams(icon);
    next.setTextSize(TypedValue.COMPLEX_UNIT_PX, 30 * scale * fontScale);
    next.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
    note.setTextSize(TypedValue.COMPLEX_UNIT_PX, 25 * scale * fontScale);
    LinearLayout.LayoutParams foot = row(-1, -2, 22);
    foot.leftMargin = px(48);
    note.setLayoutParams(foot);
  }

  private LinearLayout.LayoutParams row(int width, int height, int top) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
      width < 0 ? width : px(width),
      height < 0 ? height : Math.max(1, px(height))
    );
    params.topMargin = px(top);
    return params;
  }

  private int px(float value) {
    return Math.round(value * scale);
  }
}
