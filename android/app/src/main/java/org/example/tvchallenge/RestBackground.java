package org.example.tvchallenge;

import android.animation.ValueAnimator;
import android.content.Context;
import android.opengl.GLES30;
import android.opengl.GLSurfaceView;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/** React Bits shader adaptation: bounded GPU work, full-resolution native text above. */
final class RestBackground extends GLSurfaceView {

  static final int SILK = 0,
    AURORA = 1,
    VEIL = 2;
  private static final int[] SHADERS = {
    R.raw.rest_silk,
    R.raw.rest_aurora,
    R.raw.rest_veil,
  };
  private static int lastTheme = -1;
  private final Handler clock = new Handler(Looper.getMainLooper());
  private final Scene scene;
  private boolean active;
  private boolean resumed;
  private final Runnable frame = new Runnable() {
    @Override
    public void run() {
      if (!active || !resumed || getWindowVisibility() != VISIBLE) return;
      requestRender();
      if (
        ValueAnimator.areAnimatorsEnabled() && !scene.failed
      ) clock.postDelayed(this, 42);
    }
  };

  RestBackground(Context context) {
    this(context, nextTheme());
  }

  // Package-private injection makes all three actual shaders testable without production switches.
  RestBackground(Context context, int theme) {
    super(context);
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    setFocusable(false);
    setEGLContextClientVersion(3);
    setEGLConfigChooser(8, 8, 8, 8, 0, 0);
    setPreserveEGLContextOnPause(true);
    scene = new Scene(context, theme);
    setRenderer(scene);
    setRenderMode(RENDERMODE_WHEN_DIRTY);
  }

  boolean hasRendered() {
    return scene.compiled && scene.frames > 0;
  }

  int renderedFrames() {
    return scene.frames;
  }

  private static synchronized int nextTheme() {
    int choice = new Random().nextInt(lastTheme < 0 ? 3 : 2);
    if (lastTheme >= 0 && choice >= lastTheme) choice++;
    lastTheme = choice;
    return choice;
  }

  void setActive(boolean value) {
    active = value;
    clock.removeCallbacks(frame);
    if (value && !resumed) {
      onResume();
      resumed = true;
    }
    if (value) clock.post(frame);
    else if (resumed) {
      onPause();
      resumed = false;
    }
  }

  @Override
  protected void onSizeChanged(int w, int h, int oldw, int oldh) {
    super.onSizeChanged(w, h, oldw, oldh);
    // Only the decorative layer is capped. Android renders labels at the display's full resolution.
    if (w > 0 && h > 0) {
      float ratio = Math.min(1f, 960f / Math.max(w, h));
      getHolder().setFixedSize(
        Math.max(1, Math.round(w * ratio)),
        Math.max(1, Math.round(h * ratio))
      );
    }
  }

  @Override
  protected void onWindowVisibilityChanged(int visibility) {
    super.onWindowVisibilityChanged(visibility);
    clock.removeCallbacks(frame);
    if (visibility == VISIBLE && active) clock.post(frame);
  }

  @Override
  protected void onDetachedFromWindow() {
    active = false;
    clock.removeCallbacks(frame);
    super.onDetachedFromWindow();
  }

  static final class Scene implements Renderer {

    private final Context context;
    private final int theme;
    private final FloatBuffer vertices = ByteBuffer.allocateDirect(24)
      .order(ByteOrder.nativeOrder())
      .asFloatBuffer()
      .put(new float[] { -1, -1, 3, -1, -1, 3 });
    private final Map<String, Integer> uniforms = new HashMap<>();
    private int program;
    private int width = 1,
      height = 1;
    private long lastFrame;
    private float elapsed;
    volatile int frames;
    volatile boolean compiled;
    volatile boolean failed;

    Scene(Context context, int theme) {
      this.context = context;
      this.theme = theme;
      vertices.position(0);
    }

    @Override
    public void onSurfaceCreated(GL10 ignored, EGLConfig config) {
      uniforms.clear();
      failed = false;
      compiled = false;
      program = 0;
      GLES30.glClearColor(0.955f, 0.965f, 0.99f, 1);
      try {
        String source;
        try (
          java.io.InputStream input = context
            .getResources()
            .openRawResource(SHADERS[theme])
        ) {
          java.io.ByteArrayOutputStream bytes =
            new java.io.ByteArrayOutputStream();
          byte[] chunk = new byte[4096];
          int count;
          while ((count = input.read(chunk)) != -1)
            bytes.write(chunk, 0, count);
          source = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
        int vertex = compile(
          GLES30.GL_VERTEX_SHADER,
          "#version 300 es\nin vec2 aPosition;void main(){gl_Position=vec4(aPosition,0.,1.);}"
        );
        int fragment = compile(GLES30.GL_FRAGMENT_SHADER, source);
        program = GLES30.glCreateProgram();
        GLES30.glAttachShader(program, vertex);
        GLES30.glAttachShader(program, fragment);
        GLES30.glBindAttribLocation(program, 0, "aPosition");
        GLES30.glLinkProgram(program);
        GLES30.glDeleteShader(vertex);
        GLES30.glDeleteShader(fragment);
        int[] linked = new int[1];
        GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, linked, 0);
        if (linked[0] == 0) throw new IllegalStateException(
          GLES30.glGetProgramInfoLog(program)
        );
        compiled = true;
        Log.i(
          "RestBackground",
          "shader_ready theme=" +
            theme +
            " renderer=" +
            GLES30.glGetString(GLES30.GL_RENDERER)
        );
      } catch (Exception failure) {
        // Rendering failure must never interfere with restrictions, text or release handling.
        if (program != 0) GLES30.glDeleteProgram(program);
        program = 0;
        failed = true;
        Log.w("RestBackground", "Static light background fallback", failure);
      }
    }

    @Override
    public void onSurfaceChanged(GL10 ignored, int w, int h) {
      width = w;
      height = h;
      GLES30.glViewport(0, 0, w, h);
      lastFrame = 0;
    }

    @Override
    public void onDrawFrame(GL10 ignored) {
      GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
      if (program == 0) return;
      long now = SystemClock.uptimeMillis();
      if (lastFrame != 0 && ValueAnimator.areAnimatorsEnabled()) elapsed +=
        Math.min(0.08f, (now - lastFrame) / 1000f);
      lastFrame = now;
      GLES30.glUseProgram(program);
      GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 0, vertices);
      GLES30.glEnableVertexAttribArray(0);
      two("uView", width, height);
      two("uResolution", width, height);
      one("uTime", elapsed * 0.18f + 12f);
      if (theme == SILK) {
        one("uScale", 0.8f);
        one("uRotation", -0.35f);
        one("uWave", 0.6f);
        one("uRipple", 0.35f);
        one("uFold", 0.85f);
        two("uShift", 0, 0);
        four("uPointer", 0, 0, 0, 1);
        three("uColor", 0.68f, 0.74f, 0.96f);
        three("uSheenColor", 1, 0.96f, 0.93f);
        one("uNoiseIntensity", 0.12f);
        one("uDepth", 0.32f);
        one("uSheen", 0.35f);
        one("uGlow", 0);
        one("uLightMode", 1);
        three("uLight", -0.55f, 0.7f, 0);
        two("uStep", 1f / width, 1f / height);
        one("uPresence", 1);
        one("uFade", 0);
      } else if (theme == AURORA) {
        // Oklch stops: airy periwinkle, sky blue, warm peach.
        GLES30.glUniform3fv(
          uniform("uStops"),
          5,
          new float[] {
            .76f,
            .12f,
            4.85f,
            .86f,
            .1f,
            4.15f,
            .85f,
            .12f,
            .85f,
            .85f,
            .12f,
            .85f,
            .85f,
            .12f,
            .85f,
          },
          0
        );
        GLES30.glUniform1i(uniform("uStopCount"), 3);
        GLES30.glUniform1i(uniform("uLayers"), 2);
        one("uAmplitude", 1);
        one("uBlend", 0.85f);
        one("uHeight", 0.6f);
        one("uScale", 0.8f);
        one("uGlow", 0.65f);
        one("uBrightness", 1);
        one("uFlip", 0);
        three("uPointer", 0, 0, 0);
        one("uReveal", 1);
        one("uOpacity", 1);
        one("uLightMode", 1);
      } else {
        two("uScale", 1, 1);
        one("uZoom", 1.6f);
        two("uTurn", 0.93f, 0.36f);
        one("uFlow", 0.8f);
        one("uWarp", 0.3f);
        three("uSeed", .3948333f, .36f, .14f);
        four("uPointer", 0, 0, 0, 1);
        two("uDrag", 0, 0);
        one("uUnfold", 0);
        one("uDither", 0);
      }
      GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3);
      frames++;
    }

    private int uniform(String name) {
      Integer found = uniforms.get(name);
      if (found == null) {
        found = GLES30.glGetUniformLocation(program, name);
        uniforms.put(name, found);
      }
      return found;
    }

    private void one(String n, float x) {
      GLES30.glUniform1f(uniform(n), x);
    }

    private void two(String n, float x, float y) {
      GLES30.glUniform2f(uniform(n), x, y);
    }

    private void three(String n, float x, float y, float z) {
      GLES30.glUniform3f(uniform(n), x, y, z);
    }

    private void four(String n, float x, float y, float z, float w) {
      GLES30.glUniform4f(uniform(n), x, y, z, w);
    }

    private static int compile(int type, String source) {
      int shader = GLES30.glCreateShader(type);
      GLES30.glShaderSource(shader, source);
      GLES30.glCompileShader(shader);
      int[] status = new int[1];
      GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0);
      if (status[0] == 0) {
        String error = GLES30.glGetShaderInfoLog(shader);
        GLES30.glDeleteShader(shader);
        throw new IllegalStateException(error);
      }
      return shader;
    }
  }
}
