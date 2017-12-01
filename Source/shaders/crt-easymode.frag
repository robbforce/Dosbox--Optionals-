#version 330 core
/*
    CRT Shader by EasyMode
    License: GPL

    A flat CRT shader ideally for 1080p or higher displays.

    Recommended Settings:

    Video
    - Aspect Ratio: 4:3
    - Integer Scale: Off

    Shader
    - Filter: Nearest
    - Scale: Don't Care

    Example RGB Mask Parameter Settings:

    Aperture Grille (Default)
    - Dot Width: 1
    - Dot Height: 1
    - Stagger: 0

    Lottes' Shadow Mask
    - Dot Width: 2
    - Dot Height: 1
    - Stagger: 3
*/

#define BRIGHT_BOOST 1.2
#define DILATION 1.0
#define GAMMA_INPUT 2.0
#define GAMMA_OUTPUT 1.8
#define MASK_SIZE 1.0
#define MASK_STAGGER 0.0
#define MASK_STRENGTH 0.3
#define MASK_DOT_HEIGHT 1.0
#define MASK_DOT_WIDTH 1.0
#define SCANLINE_BEAM_WIDTH_MAX 1.5
#define SCANLINE_BEAM_WIDTH_MIN 1.5
#define SCANLINE_BRIGHT_MAX 0.65
#define SCANLINE_BRIGHT_MIN 0.35
#define SCANLINE_CUTOFF 400.0
#define SCANLINE_STRENGTH 1.0
#define SHARPNESS_H 0.5
#define SHARPNESS_V 1.0

#define FIX(c) max(abs(c), 1e-5)
#define PI 3.141592653589
#define TEX2D(c) dilate(texture(tex, c))

// Set to 0 to use linear filter and gain speed
#define ENABLE_LANCZOS 1

layout (std140) uniform program 
{
    vec2 video_size;
    vec2 texture_size;
    vec2 output_size;
} IN;

vec4 dilate(vec4 col)
{
    vec4 x = mix(vec4(1.0), col, DILATION);

    return col * x;
}

float curve_distance(float x, float sharp)
{

/*
    apply half-circle s-curve to distance for sharper (more pixelated) interpolation
    single line formula for Graph Toy:
    0.5 - sqrt(0.25 - (x - step(0.5, x)) * (x - step(0.5, x))) * sign(0.5 - x)
*/

    float x_step = step(0.5, x);
    float curve = 0.5 - sqrt(0.25 - (x - x_step) * (x - x_step)) * sign(0.5 - x);

    return mix(x, curve, sharp);
}

mat4 get_color_matrix(sampler2D tex, vec2 co, vec2 dx)
{
    return mat4(TEX2D(co - dx), TEX2D(co), TEX2D(co + dx), TEX2D(co + 2.0 * dx));
}

vec3 filter_lanczos(vec4 coeffs, mat4 color_matrix)
{
    vec4 col = color_matrix * coeffs;
    vec4 sample_min = min(color_matrix[1], color_matrix[2]);
    vec4 sample_max = max(color_matrix[1], color_matrix[2]);

    col = clamp(col, sample_min, sample_max);

    return col.rgb;
}

uniform sampler2D tex;
out vec4 color;
in vec2 coords;

void main()
{
    vec2 dx = vec2(1.0 / IN.texture_size.x, 0.0);
    vec2 dy = vec2(0.0, 1.0 / IN.texture_size.y);
    vec2 pix_co = coords * IN.texture_size - vec2(0.5, 0.5);
    vec2 tex_co = (floor(pix_co) + vec2(0.5, 0.5)) / IN.texture_size;
    vec2 dist = fract(pix_co);
    float curve_x;
    vec3 col, col2;

#if ENABLE_LANCZOS
    curve_x = curve_distance(dist.x, SHARPNESS_H * SHARPNESS_H);

    vec4 coeffs = PI * vec4(1.0 + curve_x, curve_x, 1.0 - curve_x, 2.0 - curve_x);

    coeffs = FIX(coeffs);
    coeffs = 2.0 * sin(coeffs) * sin(coeffs / 2.0) / (coeffs * coeffs);
    coeffs /= dot(coeffs, vec4(1.0));

    col = filter_lanczos(coeffs, get_color_matrix(tex, tex_co, dx));
    col2 = filter_lanczos(coeffs, get_color_matrix(tex, tex_co + dy, dx));
#else
    curve_x = curve_distance(dist.x, SHARPNESS_H);

    col = mix(TEX2D(tex_co).rgb, TEX2D(tex_co + dx).rgb, curve_x);
    col2 = mix(TEX2D(tex_co + dy).rgb, TEX2D(tex_co + dx + dy).rgb, curve_x);
#endif

    col = mix(col, col2, curve_distance(dist.y, SHARPNESS_V));
    col = pow(col, vec3(GAMMA_INPUT / (DILATION + 1.0)));

    float luma = dot(vec3(0.2126, 0.7152, 0.0722), col);
    float bright = (max(col.r, max(col.g, col.b)) + luma) / 2.0;
    float scan_bright = clamp(bright, SCANLINE_BRIGHT_MIN, SCANLINE_BRIGHT_MAX);
    float scan_beam = clamp(bright * SCANLINE_BEAM_WIDTH_MAX, SCANLINE_BEAM_WIDTH_MIN, SCANLINE_BEAM_WIDTH_MAX);
    float scan_weight = 1.0 - pow(cos(coords.y * 2.0 * PI * IN.texture_size.y) * 0.5 + 0.5, scan_beam) * SCANLINE_STRENGTH;

    float mask = 1.0 - MASK_STRENGTH;    
    vec2 mod_fac = floor(coords * IN.output_size * IN.texture_size / (IN.video_size * vec2(MASK_SIZE, MASK_DOT_HEIGHT * MASK_SIZE)));
    int dot_no = int(mod((mod_fac.x + mod(mod_fac.y, 2.0) * MASK_STAGGER) / MASK_DOT_WIDTH, 3.0));
    vec3 mask_weight;

    if (dot_no == 0) mask_weight = vec3(1.0, mask, mask);
    else if (dot_no == 1) mask_weight = vec3(mask, 1.0, mask);
    else mask_weight = vec3(mask, mask, 1.0);

    if (IN.video_size.y >= SCANLINE_CUTOFF) scan_weight = 1.0;

    col2 = col.rgb;
    col *= vec3(scan_weight);
    col = mix(col, col2, scan_bright);
    col *= mask_weight;
    col = pow(col, vec3(1.0 / GAMMA_OUTPUT));

    color = vec4(col * BRIGHT_BOOST, 1.0);
}
