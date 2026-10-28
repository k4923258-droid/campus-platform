package cn.campus.platform;

import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

@Configuration
public class SecurityConfig {

  @Bean
  SecurityFilterChain chain(HttpSecurity http) throws Exception {
    return http
      .authorizeHttpRequests(a -> a.anyRequest().permitAll())
      .csrf(c ->
        c
          .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
          .csrfTokenRequestHandler(
            new org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler()
          )
      )
      .formLogin(f -> f.disable())
      .httpBasic(b -> b.disable())
      .logout(l -> l.disable())
      .headers(h ->
        h.contentSecurityPolicy(c ->
          c.policyDirectives(
            "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
          )
        )
      )
      .build();
  }
}
